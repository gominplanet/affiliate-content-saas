// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shorts Studio video-ingestion service — the "no upload" downloader.
//
// The main app (Vercel) can't pull a video from YouTube (blocked IPs, no yt-dlp,
// no long-running process). This tiny always-on service does: given a video id,
// it downloads the MP4 with yt-dlp and uploads it to our Supabase Storage, then
// returns the public URL. The app stores that on youtube_videos.source_video_url
// and the rest of Shorts Studio (Whisper transcript + Cloudinary render) just
// works — exactly the vidIQ "select a video → Get clips" flow.
//
// Storage is done over Supabase's HTTP API directly (not @supabase/supabase-js):
// the SDK eagerly initialises a realtime WebSocket at createClient() and crashes
// on Node without a global WebSocket — and we only need a file upload anyway.
//
// Deploy this anywhere with a normal IP (Railway / Fly / Render). See README.md.
//
// Contract:
//   POST /ingest   header x-ingest-secret: <INGEST_SECRET>
//     req  { videoId: "<11-char id>", userId?: "<uuid>" }
//     res  { url: "https://…public…/…​.mp4", durationSeconds: number|null }
//   GET  /health -> { ok: true }

// v2: relaxed format selector (any-codec ≤1080p → mp4) + cookies. Bump this
// comment to force a Railway redeploy of the latest ingest-service code.
const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')

const PORT = process.env.PORT || 8080
const SECRET = process.env.INGEST_SECRET || ''
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_BUCKET || 'instagram-videos'
// Cost guard: refuse videos longer than this (seconds). Default 2h (vidIQ's cap).
const MAX_SECONDS = Number(process.env.MAX_SECONDS || 7200)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// YouTube bot-walls datacenter IPs ("Sign in to confirm you're not a bot").
// Passing cookies from a logged-in session makes yt-dlp fetch as that user.
// Supply them base64-encoded (a Netscape cookies.txt) via YOUTUBE_COOKIES_B64
// — base64 avoids newline mangling in the Railway/Vercel env UI. Optional:
// without it the service still works for videos that don't need auth.
let COOKIES_FILE = null
if (process.env.YOUTUBE_COOKIES_B64) {
  try {
    COOKIES_FILE = path.join(os.tmpdir(), 'yt-cookies.txt')
    fs.writeFileSync(COOKIES_FILE, Buffer.from(process.env.YOUTUBE_COOKIES_B64, 'base64').toString('utf8'))
    console.log('yt-dlp cookies loaded')
  } catch (e) {
    console.error('YOUTUBE_COOKIES_B64 invalid:', e && e.message)
    COOKIES_FILE = null
  }
}
// Optional extra yt-dlp args (space-separated) for advanced tweaks.
const EXTRA_ARGS = (process.env.YT_DLP_EXTRA || '').trim().split(/\s+/).filter(Boolean)
// Residential/mobile proxy — the reliable fix for YouTube's "confirm you're not
// a bot" wall on datacenter IPs. Set YT_DLP_PROXY to e.g.
// http://user:pass@host:port and every yt-dlp call routes through it.
const PROXY = (process.env.YT_DLP_PROXY || '').trim()
// YouTube player clients to try, in order. Alternate clients (web_safari, mweb)
// slip past the bot check more often than the default web client alone.
const PLAYER_CLIENTS = (process.env.YT_DLP_PLAYER_CLIENTS || 'default,web_safari,mweb').trim()

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

function ytDlp(args) {
  // Every yt-dlp call gets: proxy (if set) + cookies (if set) + alternate
  // player clients + retries, to beat YouTube's bot check as best we can.
  const full = [
    ...(PROXY ? ['--proxy', PROXY] : []),
    ...(COOKIES_FILE ? ['--cookies', COOKIES_FILE] : []),
    '--extractor-args', `youtube:player_client=${PLAYER_CLIENTS}`,
    '--extractor-retries', '3',
    ...EXTRA_ARGS,
    ...args,
  ]
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', full, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').slice(0, 500)))
      else resolve(stdout)
    })
  })
}

// Download a URL to a local file. ffmpeg seeking a LOCAL file is instant and
// reliable; seeking a remote URL over HTTP is fragile (moov-atom location, range
// support) and was failing silently. So we fetch first, then trim locally.
async function downloadToFile(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`source fetch ${res.status}`)
  // STREAM to disk (constant memory) — buffering a 100MB+ file in a Node Buffer
  // spikes memory and OOM-kills ffmpeg on a small container.
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
  return fs.statSync(dest).size
}

// Cut [startSec, startSec+dur] out of a LOCAL video into a small mp4. Fast
// input-seek + re-encode = frame-accurate and tiny, so Cloudinary never has to
// ingest the whole source (its 100MB cap is why full-video render failed).
function ffmpegClip(input, startSec, dur, outPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-threads', '1',
      '-ss', String(startSec), '-i', input, '-t', String(dur),
      // Cap at 720p — the clip is reframed to 9:16 by Cloudinary anyway, so 1080p
      // is wasted memory/bytes here; keeps the encode light on a small container.
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', outPath,
    ], { maxBuffer: 1024 * 1024 * 64 }, (err, _so, se) => {
      if (err) {
        // Empty stderr + a signal = the process was killed (usually OOM).
        const detail = (se && se.trim()) || `${err.message || 'failed'}${err.signal ? ` [signal ${err.signal}]` : ''}`
        reject(new Error('ffmpeg: ' + detail.slice(0, 400)))
      } else resolve()
    })
  })
}

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], (err, stdout) => {
      if (err) return resolve(null)
      const d = parseFloat(String(stdout).trim())
      resolve(Number.isFinite(d) ? Math.round(d) : null)
    })
  })
}

// Upload a LOCAL file to Supabase Storage over the REST API (service role
// bypasses RLS). Streams straight from disk — reading the whole MP4 into a Node
// Buffer (fs.readFileSync) is what OOM-killed the container on long videos.
async function uploadToSupabase(key, filePath) {
  const size = fs.statSync(filePath).size
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'x-upsert': 'true',
    },
    // Stream the file body (constant memory). duplex:'half' is required by fetch
    // for a streaming request body.
    body: Readable.toWeb(fs.createReadStream(filePath)),
    duplex: 'half',
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`storage upload ${res.status}: ${t.slice(0, 200)}`)
  }
}

function publicUrl(key) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
}

app.post('/ingest', async (req, res) => {
  if (SECRET && req.get('x-ingest-secret') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const videoId = String(req.body?.videoId || '').trim()
  const userId = String(req.body?.userId || '').trim()
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'bad videoId' })
  }
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const tmp = path.join(os.tmpdir(), `${videoId}-${Date.now()}.mp4`)

  try {
    // Duration pre-check (cheap) to bound cost / reject over-long videos.
    try {
      const durOut = await ytDlp(['--no-warnings', '--print', '%(duration)s', url])
      const dur = parseInt(String(durOut).trim(), 10)
      if (Number.isFinite(dur) && dur > MAX_SECONDS) {
        return res.status(413).json({ error: `Video is ${Math.round(dur / 60)}m — over the ${Math.round(MAX_SECONDS / 60)}m limit.` })
      }
    } catch { /* non-fatal — proceed to download */ }

    // Best video ≤720p + best audio, ANY codec (VP9/webm included), merged to
    // mp4 by ffmpeg. 720p (not 1080p) because Shorts are a 9:16 center-crop that
    // Cloudinary re-encodes anyway, so 1080p is wasted bytes — and the download
    // runs through a per-GB residential proxy, so ~halving the bytes ~halves the
    // dominant per-video cost. No ext filter — that's what caused "Requested
    // format is not available" on videos YouTube only serves in webm.
    await ytDlp([
      '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '-o', tmp,
      '--no-playlist', '--no-warnings',
      url,
    ])
    if (!fs.existsSync(tmp)) throw new Error('download produced no file')

    // Path shape matches the bucket's RLS convention (first folder = user id)
    // when we know the user; the service role bypasses RLS either way.
    const key = `${userId || 'ingest'}/ingest-${videoId}-${Date.now()}.mp4`
    await uploadToSupabase(key, tmp)

    const durationSeconds = await ffprobeDuration(tmp)
    return res.json({ url: publicUrl(key), durationSeconds })
  } catch (e) {
    console.error('[ingest] failed', videoId, e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

// Trim a segment out of an already-hosted video and return a small mp4 URL, so
// the render only sends Cloudinary the clip (not the whole 100MB+ source).
app.post('/clip', async (req, res) => {
  if (SECRET && req.get('x-ingest-secret') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const url = String(req.body?.url || '').trim()
  const userId = String(req.body?.userId || '').trim()
  const startSec = Number(req.body?.startSec)
  const endSec = Number(req.body?.endSec)
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'bad url' })
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    return res.status(400).json({ error: 'bad window' })
  }
  // Clips are 15–30s; cap defensively so a bad request can't cut a huge segment.
  const dur = Math.min(120, endSec - startSec)
  const srcTmp = path.join(os.tmpdir(), `src-${Date.now()}.mp4`)
  const outTmp = path.join(os.tmpdir(), `clip-${Date.now()}-${Math.round(startSec)}.mp4`)
  try {
    // Fetch the source locally, then trim the local file (reliable seeking).
    await downloadToFile(url, srcTmp)
    await ffmpegClip(srcTmp, Math.max(0, startSec), dur, outTmp)
    if (!fs.existsSync(outTmp)) throw new Error('clip produced no file')
    const key = `${userId || 'ingest'}/clip-${Date.now()}-${Math.round(startSec)}.mp4`
    await uploadToSupabase(key, outTmp)
    return res.json({ url: publicUrl(key), durationSeconds: Math.round(dur * 10) / 10 })
  } catch (e) {
    console.error('[clip] failed', e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    try { if (fs.existsSync(srcTmp)) fs.unlinkSync(srcTmp) } catch { /* ignore */ }
    try { if (fs.existsSync(outTmp)) fs.unlinkSync(outTmp) } catch { /* ignore */ }
  }
})

// BUILD marker: bump this string when the service code changes so the Railway
// deploy logs unambiguously show which build is actually running (Railway can
// re-run an older commit). "streaming-upload" = the OOM fix (uploads stream
// from disk instead of buffering the whole file).
const BUILD = '720p-streaming-2026-07-25'
app.listen(PORT, () => console.log(`ingest-service listening on :${PORT} [build ${BUILD}]`))
