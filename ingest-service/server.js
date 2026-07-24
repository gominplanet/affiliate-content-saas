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

const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

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

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

function ytDlp(args) {
  // Prepend cookies (if configured) + any extra args to every yt-dlp call.
  const full = [
    ...(COOKIES_FILE ? ['--cookies', COOKIES_FILE] : []),
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

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], (err, stdout) => {
      if (err) return resolve(null)
      const d = parseFloat(String(stdout).trim())
      resolve(Number.isFinite(d) ? Math.round(d) : null)
    })
  })
}

// Upload bytes to Supabase Storage over the REST API (service role bypasses RLS).
async function uploadToSupabase(key, buf) {
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: buf,
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

    // Best merged mp4 up to 1080p (keeps files sane; Shorts are 9:16 anyway).
    await ytDlp([
      '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4',
      '-o', tmp,
      '--no-playlist', '--no-warnings',
      url,
    ])
    if (!fs.existsSync(tmp)) throw new Error('download produced no file')

    const buf = fs.readFileSync(tmp)
    // Path shape matches the bucket's RLS convention (first folder = user id)
    // when we know the user; the service role bypasses RLS either way.
    const key = `${userId || 'ingest'}/ingest-${videoId}-${Date.now()}.mp4`
    await uploadToSupabase(key, buf)

    const durationSeconds = await ffprobeDuration(tmp)
    return res.json({ url: publicUrl(key), durationSeconds })
  } catch (e) {
    console.error('[ingest] failed', videoId, e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

app.listen(PORT, () => console.log(`ingest-service listening on :${PORT}`))
