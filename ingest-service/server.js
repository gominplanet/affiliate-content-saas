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
const { createClient } = require('@supabase/supabase-js')

const PORT = process.env.PORT || 8080
const SECRET = process.env.INGEST_SECRET || ''
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_BUCKET || 'instagram-videos'
// Cost guard: refuse videos longer than this (seconds). Default 2h (vidIQ's cap).
const MAX_SECONDS = Number(process.env.MAX_SECONDS || 7200)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

function ytDlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
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
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, buf, {
      contentType: 'video/mp4', upsert: true,
    })
    if (upErr) throw new Error(upErr.message)
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(key)

    const durationSeconds = await ffprobeDuration(tmp)
    return res.json({ url: publicUrl, durationSeconds })
  } catch (e) {
    console.error('[ingest] failed', videoId, e && e.message)
    return res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) })
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
})

app.listen(PORT, () => console.log(`ingest-service listening on :${PORT}`))
