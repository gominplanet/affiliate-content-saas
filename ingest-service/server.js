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
const zlib = require('zlib')
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
//
// Railway/Vercel cap a single env var at 32768 chars. A full browser cookie
// export blows past that, so we take the value three ways and use whichever is
// set (all optional, tried in this order):
//   1. YOUTUBE_COOKIES_URL   — download the cookies.txt from a URL at boot (no
//                              size limit; the cleanest option for big files).
//   2. YOUTUBE_COOKIES_B64   — base64 of the cookies.txt, optionally gzipped
//      (+ _2, _3, …)           first (auto-detected). Split across numbered vars
//                              to stay under the 32768 cap; they're concatenated
//                              in order before decoding.
// Best practice regardless: export ONLY youtube.com + google.com cookies, not
// your whole browser jar. yt-dlp doesn't use the rest, and the trimmed file
// fits in a single var.
const COOKIES_FILE = path.join(os.tmpdir(), 'yt-cookies.txt')
let cookiesReady = false

// Decode a base64 (optionally gzip-compressed) blob to utf8 text. gzip is
// auto-detected from its magic bytes (0x1f 0x8b), so a plain OR gzipped base64
// both work with no flag.
function decodeCookieBlob(b64) {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return zlib.gunzipSync(buf).toString('utf8')
  }
  return buf.toString('utf8')
}

// Concatenate YOUTUBE_COOKIES_B64 + YOUTUBE_COOKIES_B64_2 + _3 … (in numeric
// order) so a big cookies file can be split across the 32768-char env cap.
function joinedCookieB64() {
  const parts = []
  if (process.env.YOUTUBE_COOKIES_B64) parts.push(process.env.YOUTUBE_COOKIES_B64.trim())
  for (let i = 2; process.env[`YOUTUBE_COOKIES_B64_${i}`]; i++) {
    parts.push(process.env[`YOUTUBE_COOKIES_B64_${i}`].trim())
  }
  return parts.join('')
}

async function loadCookies() {
  const url = (process.env.YOUTUBE_COOKIES_URL || '').trim()
  if (url) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const text = (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
        ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
      fs.writeFileSync(COOKIES_FILE, text)
      cookiesReady = true
      console.log(`yt-dlp cookies loaded from URL (${text.split('\n').filter(Boolean).length} lines)`)
      return
    } catch (e) {
      console.error('YOUTUBE_COOKIES_URL fetch failed:', e && e.message)
    }
  }
  const b64 = joinedCookieB64()
  if (b64) {
    try {
      const text = decodeCookieBlob(b64)
      fs.writeFileSync(COOKIES_FILE, text)
      cookiesReady = true
      console.log(`yt-dlp cookies loaded (${text.split('\n').filter(Boolean).length} lines)`)
      return
    } catch (e) {
      console.error('YOUTUBE_COOKIES_B64 invalid:', e && e.message)
    }
  }
  if (!cookiesReady) console.log('no yt-dlp cookies set — auth-gated videos may hit the bot wall')
}
// Optional extra yt-dlp args (space-separated) for advanced tweaks.
const EXTRA_ARGS = (process.env.YT_DLP_EXTRA || '').trim().split(/\s+/).filter(Boolean)
// Residential/mobile proxy — the reliable fix for YouTube's "confirm you're not
// a bot" wall on datacenter IPs. Set YT_DLP_PROXY to e.g.
// http://user:pass@host:port and every yt-dlp call routes through it.
const PROXY = (process.env.YT_DLP_PROXY || '').trim()
// YouTube player clients to try, in order. Alternate clients (web_safari, mweb)
// slip past the bot check more often than the default web client alone.
const PLAYER_CLIENTS = (process.env.YT_DLP_PLAYER_CLIENTS || 'default,web_safari,mweb,tv,ios').trim()
// PO-token provider (bgutil). YouTube now demands a "proof of origin" token even
// from residential IPs / logged-out access, which is why cookie-free downloads
// still hit the "confirm you're not a bot" wall. The bgutil yt-dlp plugin (baked
// into the image at /opt/ytdlp-plugins) fetches one from a companion provider
// service — no login, no cookies. Point YT_DLP_POT_BASE_URL at that service, e.g.
// http://bgutil-provider.railway.internal:4416. Empty = feature off.
const POT_BASE_URL = (process.env.YT_DLP_POT_BASE_URL || '').trim()

// yt-dlp update channel. YouTube's bot-wall / player fixes land in the NIGHTLY
// channel days after a block, while STABLE only cuts a release ~monthly — so a
// downloader fighting YouTube should track nightly. Override with YT_DLP_CHANNEL
// (e.g. 'stable') if a nightly ever regresses.
const YT_DLP_CHANNEL = (process.env.YT_DLP_CHANNEL || 'nightly').trim()

// yt-dlp self-update on boot. yt-dlp is pip-installed (so the bgutil plugin
// auto-loads), so we refresh it with pip rather than the standalone `--update-to`.
// `--pre` pulls the latest NIGHTLY pre-release (YouTube fixes land there first);
// YT_DLP_CHANNEL=stable drops `--pre` for the stable line. Best-effort: a failed
// update never blocks startup, and the live version is surfaced on /health.
let ytDlpVersion = 'unknown'
function readYtDlpVersion() {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], (err, stdout) => resolve(err ? 'unknown' : (stdout || '').trim()))
  })
}
async function selfUpdateYtDlp() {
  const preFlag = YT_DLP_CHANNEL === 'stable' ? [] : ['--pre']
  await new Promise((resolve) => {
    execFile('pip3', ['install', '--no-cache-dir', '--break-system-packages', ...preFlag, '-U', 'yt-dlp[default]'], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) console.warn('yt-dlp pip update failed (keeping installed version):', (stderr || err.message || '').slice(0, 200))
      else console.log('yt-dlp pip update:', ((stdout || '').trim().split('\n').pop() || '').slice(0, 140))
      resolve()
    })
  })
  ytDlpVersion = await readYtDlpVersion()
  console.log(`yt-dlp version: ${ytDlpVersion} (channel ${YT_DLP_CHANNEL})`)
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true, cookies: cookiesReady, ytDlp: ytDlpVersion, ytDlpChannel: YT_DLP_CHANNEL, potProvider: !!POT_BASE_URL, build: BUILD }))

function ytDlp(args) {
  // Every yt-dlp call gets: proxy (if set) + cookies (if set) + alternate
  // player clients + retries, to beat YouTube's bot check as best we can.
  const full = [
    ...(PROXY ? ['--proxy', PROXY] : []),
    ...(cookiesReady ? ['--cookies', COOKIES_FILE] : []),
    '--extractor-args', `youtube:player_client=${PLAYER_CLIENTS}`,
    // Tell the bgutil plugin where the PO-token provider lives (only when set).
    ...(POT_BASE_URL ? ['--extractor-args', `youtubepot-bgutilhttp:base_url=${POT_BASE_URL}`] : []),
    '--extractor-retries', '3',
    // VERBOSE flag (toggle with YT_DLP_VERBOSE=0). Surfaces "Loaded N plugins" +
    // the PO-token provider's own log lines in stderr so we can see whether the
    // bgutil plugin actually loaded and reached the provider.
    ...(process.env.YT_DLP_VERBOSE === '0' ? [] : ['--verbose']),
    ...EXTRA_ARGS,
    ...args,
  ]
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', full, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) {
        const full = (stderr || err.message || '')
        // Log the FULL verbose stderr to the container console for diagnosis, but
        // keep the thrown/HTTP error trimmed so the app UI stays readable.
        console.error('[yt-dlp] failed, full stderr:\n' + full)
        reject(new Error(full.slice(0, 500)))
      } else resolve(stdout)
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
async function uploadToSupabase(key, filePath, contentType = 'video/mp4') {
  const size = fs.statSync(filePath).size
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': contentType,
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

// ── Hormozi-style captions (FFmpeg + libass) ────────────────────────────────
// Word-by-word: 1–3 words on screen, the ACTIVE word pops (scale bounce) and
// turns yellow as it's spoken. Rendered as an ASS subtitle burned by ffmpeg,
// which is what the good caption tools do — Cloudinary's static text can't.

function assTime(sec) {
  let s = Number(sec)
  if (!Number.isFinite(s) || s < 0) s = 0
  const cs = Math.round(s * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const ss = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

// Strip ASS-special chars so a stray brace/backslash can't break the subtitle.
function assEscape(t) {
  return String(t == null ? '' : t).replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()
}

// Normalize incoming cues to per-WORD timing. Single-word cues (Whisper
// word-level) pass through with real timings; multi-word cues (phrase-level
// source) are split evenly across their span so we still get word animation.
function toWords(cues) {
  const out = []
  for (const c of Array.isArray(cues) ? cues : []) {
    const start = Number(c && (c.startSec != null ? c.startSec : c.start))
    let end = Number(c && (c.endSec != null ? c.endSec : c.end))
    const text = assEscape(c && c.text)
    if (!text || !Number.isFinite(start)) continue
    if (!Number.isFinite(end) || end <= start) end = start + 0.4
    const toks = text.split(/\s+/).filter(Boolean)
    if (toks.length <= 1) { out.push({ start, end, text: toks[0] || text }); continue }
    const per = (end - start) / toks.length
    toks.forEach((w, i) => out.push({ start: start + i * per, end: start + (i + 1) * per, text: w }))
  }
  return out.sort((a, b) => a.start - b.start)
}

// Group words into short lines (<=maxWords, break on a speech pause or sentence).
function groupLines(words, maxWords, gap) {
  const lines = []
  let cur = []
  const flush = () => { if (cur.length) { lines.push(cur); cur = [] } }
  for (const w of words) {
    if (cur.length) {
      const g = w.start - cur[cur.length - 1].end
      if (cur.length >= maxWords || g > gap || /[.!?]$/.test(cur[cur.length - 1].text)) flush()
    }
    cur.push(w)
  }
  flush()
  return lines
}

function buildAss(cues) {
  const words = toWords(cues)
  const lines = groupLines(words, 3, 0.6)
  const HIGHLIGHT = '&H0000FFFF&' // yellow, ASS is &HBBGGRR

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 1',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Anton 108, white fill, black outline 8 + shadow 4, bottom-center, MarginV 520.
    'Style: Cap,Anton,108,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,8,4,2,120,120,520,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  // Flatten to ONE global, time-ordered sequence (each word tagged with its
  // line). Building events per-line let a line's last word hold to its own end,
  // which (a) left a gap before the next line → flicker, and (b) could overlap
  // the next line when Whisper word times cross → two lines stacked ("stepping
  // over each other"). Here every word event ends exactly when the NEXT word
  // starts, so the track is gap-free and never overlaps.
  const seq = []
  for (const line of lines) for (let i = 0; i < line.length; i++) seq.push({ line, i, start: line[i].start, end: line[i].end })
  seq.sort((a, b) => a.start - b.start)

  const events = []
  for (let k = 0; k < seq.length; k++) {
    const cur = seq[k]
    const start = cur.start
    const next = seq[k + 1]
    const end = Math.max(start + 0.05, next ? next.start : cur.end)
    const text = cur.line.map((w, j) => {
      const up = w.text.toUpperCase()
      return j === cur.i
        ? `{\\c${HIGHLIGHT}\\fscx118\\fscy118\\t(0,90,\\fscx100\\fscy100)}${up}{\\r}`
        : up
    }).join(' ')
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`)
  }
  return `${header}\n${events.join('\n')}\n`
}

function ffmpegRender(input, startSec, dur, vf, outPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-threads', '1',
      // -ss before -i is fast AND frame-accurate in modern ffmpeg; output PTS
      // resets to 0 at startSec, so the clip-relative caption timings line up.
      '-ss', String(startSec), '-i', input, '-t', String(dur),
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      // Keep the encoder's memory footprint small so a low-RAM container (Railway)
      // doesn't OOM-kill ffmpeg mid-render: no B-frames, single ref frame, and no
      // lookahead buffers. Negligible quality hit for a short clip.
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:sync-lookahead=0',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', outPath,
    ], { maxBuffer: 1024 * 1024 * 64 }, (err, _so, se) => {
      if (err) reject(new Error('ffmpeg: ' + (((se && se.trim()) || err.message || 'failed') + (err.signal ? ` [signal ${err.signal}]` : '')).slice(0, 400)))
      else resolve()
    })
  })
}

// POST /audio — download AUDIO ONLY for transcription (tiny vs the full video),
// the main proxy-bandwidth saver. Body: { videoId, userId } -> { url }.
app.post('/audio', async (req, res) => {
  if (SECRET && req.get('x-ingest-secret') !== SECRET) return res.status(401).json({ error: 'unauthorized' })
  const videoId = String(req.body?.videoId || '').trim()
  const userId = String(req.body?.userId || '').trim()
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' })
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const tmp = path.join(os.tmpdir(), `aud-${videoId}-${Date.now()}.m4a`)
  try {
    try {
      const durOut = await ytDlp(['--no-warnings', '--print', '%(duration)s', url])
      const dur = parseInt(String(durOut).trim(), 10)
      if (Number.isFinite(dur) && dur > MAX_SECONDS) {
        return res.status(413).json({ error: `Video is ${Math.round(dur / 60)}m — over the ${Math.round(MAX_SECONDS / 60)}m limit.` })
      }
    } catch { /* non-fatal */ }
    await ytDlp(['-f', 'ba[ext=m4a]/ba/bestaudio', '-o', tmp, '--no-playlist', '--no-warnings', url])
    if (!fs.existsSync(tmp)) throw new Error('audio download produced no file')
    const key = `${userId || 'ingest'}/audio-${videoId}-${Date.now()}.m4a`
    await uploadToSupabase(key, tmp, 'audio/mp4')
    return res.json({ url: publicUrl(key) })
  } catch (e) {
    console.error('[audio] failed', videoId, e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

// ── Render options: split-screen reframe (#1) ────────────────────────────────
// The reframe filtergraph lives in render-filters.js so it's unit-tested
// directly (test-render-filters.js).
const { reframeChain } = require('./render-filters')

// Run ffmpeg with a -filter_complex graph (the split-screen path).
function ffmpegRenderComplex(input, startSec, dur, filterComplex, audioMap, outPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-threads', '1',
      '-ss', String(startSec), '-i', input, '-t', String(dur),
      '-filter_complex', filterComplex,
      '-map', '[vout]', '-map', audioMap,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:sync-lookahead=0',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', outPath,
    ], { maxBuffer: 1024 * 1024 * 64 }, (err, _so, se) => {
      if (err) reject(new Error('ffmpeg: ' + (((se && se.trim()) || err.message || 'failed') + (err.signal ? ` [signal ${err.signal}]` : '')).slice(0, 400)))
      else resolve()
    })
  })
}

// POST /render-short — trim [startSec,endSec] + reframe to 1080x1920 + burn
// Hormozi captions in ONE ffmpeg pass. Two source modes:
//   - youtubeVideoId: download ONLY the [start,end] section (bandwidth saver)
//   - videoUrl: a hosted source (a creator upload) — download + seek
// Body: { videoUrl?|youtubeVideoId?, startSec, endSec, words[], userId,
//         reframe?: 'center'|'split' }.
app.post('/render-short', async (req, res) => {
  if (SECRET && req.get('x-ingest-secret') !== SECRET) return res.status(401).json({ error: 'unauthorized' })
  const url = String(req.body?.videoUrl || '').trim()
  const ytVid = String(req.body?.youtubeVideoId || '').trim()
  const startSec = Math.max(0, Number(req.body?.startSec) || 0)
  const endSec = Number(req.body?.endSec)
  const words = Array.isArray(req.body?.words) ? req.body.words : []
  const userId = String(req.body?.userId || '').trim()
  const reframeMode = req.body?.reframe === 'split' ? 'split' : 'center'
  const fromYouTube = /^[A-Za-z0-9_-]{11}$/.test(ytVid)
  if (!fromYouTube && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'bad source' })
  if (!Number.isFinite(endSec) || endSec <= startSec) return res.status(400).json({ error: 'bad window' })
  const dur = Math.min(180, endSec - startSec)
  const srcTmp = path.join(os.tmpdir(), `rsrc-${Date.now()}.mp4`)
  const assTmp = path.join(os.tmpdir(), `rcap-${Date.now()}.ass`)
  const outTmp = path.join(os.tmpdir(), `rout-${Date.now()}.mp4`)
  try {
    // How far into srcTmp the clip starts: 0 when we download only the section
    // (already trimmed), else startSec when we have the full hosted source.
    let renderStart = startSec
    if (fromYouTube) {
      // Download ONLY the [start,end] window — ~15-30MB vs the whole video.
      await ytDlp([
        '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
        '--download-sections', `*${startSec}-${endSec}`,
        '--force-keyframes-at-cuts',
        '--merge-output-format', 'mp4',
        '-o', srcTmp, '--no-playlist', '--no-warnings',
        `https://www.youtube.com/watch?v=${ytVid}`,
      ])
      renderStart = 0
    } else {
      await downloadToFile(url, srcTmp)
    }
    if (!fs.existsSync(srcTmp)) throw new Error('source download produced no file')

    const withCaptions = words.length > 0
    if (withCaptions) fs.writeFileSync(assTmp, buildAss(words))
    // Output at 720x1280 (9:16). The source is already capped at ≤720p, so this
    // avoids a wasteful upscale to 1080 — and, critically, halves the pixels the
    // x264 encoder has to buffer, which is what was OOM-killing ffmpeg on
    // Railway's small container. libass scales the 1080-designed captions down to
    // fit automatically (they're positioned via PlayResX/Y), so they look
    // identical, just at 720p. Override with RENDER_HEIGHT if you have more RAM.
    const H = Math.max(640, Math.min(1920, Number(process.env.RENDER_HEIGHT || 1280)))
    const W = Math.round(H * 9 / 16 / 2) * 2 // keep 9:16, even width for yuv420p

    if (reframeMode === 'split') {
      // Split-screen path — a -filter_complex graph (vstack of the two halves),
      // optionally burning captions. Audio passes through untouched.
      const graph = reframeChain('[0:v]', 'split', W, H, withCaptions ? assTmp : null)
      await ffmpegRenderComplex(srcTmp, renderStart, dur, graph, '0:a?', outTmp)
    } else {
      // Default path — the original simple -vf center-crop (unchanged, low-risk).
      const reframe = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
      const vf = withCaptions ? `${reframe},ass=${assTmp}` : reframe
      await ffmpegRender(srcTmp, renderStart, dur, vf, outTmp)
    }
    if (!fs.existsSync(outTmp)) throw new Error('render produced no file')
    const key = `${userId || 'ingest'}/short-${Date.now()}.mp4`
    await uploadToSupabase(key, outTmp)
    return res.json({ url: publicUrl(key), durationSeconds: Math.round(dur * 10) / 10 })
  } catch (e) {
    console.error('[render-short] failed', e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    for (const f of [srcTmp, assTmp, outTmp]) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* ignore */ } }
  }
})

// BUILD marker: bump this string when the service code changes so the Railway
// deploy logs unambiguously show which build is actually running (Railway can
// re-run an older commit).
const BUILD = 'ytdlp-pip+plugin-autoload-2026-08-09'
Promise.allSettled([loadCookies(), selfUpdateYtDlp()]).finally(() => {
  app.listen(PORT, () => console.log(`ingest-service listening on :${PORT} [build ${BUILD}] yt-dlp ${ytDlpVersion}`))
})
