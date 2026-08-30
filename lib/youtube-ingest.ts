// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Server-side video ingestion — the piece that lets Shorts Studio work WITHOUT
 * an upload (the bold "select a video → Get clips" flow).
 *
 * YouTube's ToS-respecting reality: we can't pull the video from a Vercel
 * serverless function (blocked IPs, no yt-dlp binary, no long-running process).
 * So we call out to a small, always-on downloader service the operator deploys
 * (see ingest-service/). It fetches the creator's own video, uploads the MP4 to
 * our Supabase storage, and returns the public URL — which then feeds Whisper
 * (transcript) and Cloudinary (render), exactly like a manual upload would.
 *
 * ENTIRELY env-gated: with YOUTUBE_INGEST_URL unset this is a no-op and the
 * feature falls back to the manual upload. Nothing changes until it's wired.
 *
 * Contract (POST `${YOUTUBE_INGEST_URL}/ingest`, header x-ingest-secret):
 *   req:  { videoId: "<11-char youtube id>" }
 *   res:  { url: "https://…/source.mp4", durationSeconds: number }
 */

export function ingestConfigured(): boolean {
  return !!process.env.YOUTUBE_INGEST_URL
}

// Last ingest-service failure reason (status + trimmed body / exception), so a
// caller can surface WHY a fetch/render failed instead of a blank "it failed".
// YouTube blocks most server-side downloads, so the segment path fails a lot;
// this is what tells us (and the user) it was a download block vs a real bug.
let _lastIngestError: string | null = null
export function getLastIngestError(): string | null { return _lastIngestError }
function setIngestError(e: string | null) { _lastIngestError = e }

export interface IngestResult {
  url: string
  durationSeconds: number | null
}

/**
 * Ask the downloader service to fetch a YouTube video and return a hosted MP4
 * URL. Returns null when unconfigured or on any failure — the caller then falls
 * back to prompting the creator to upload the file.
 */
export async function ingestYouTubeVideo(youtubeVideoId: string, userId?: string): Promise<IngestResult | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !youtubeVideoId) return null
  try {
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({ videoId: youtubeVideoId, ...(userId ? { userId } : {}) }),
      // Downloading + uploading a long video takes a while; give the service room.
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string; durationSeconds?: number }
    if (!data?.url || !/^https:\/\//i.test(data.url)) return null
    return { url: data.url, durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : null }
  } catch {
    return null
  }
}

/**
 * Trim a [startSec, endSec] segment out of an already-hosted video (the source
 * MP4) and return a small hosted clip URL. This keeps Cloudinary under its
 * 100MB upload cap — we only ever hand it the ~15-30s clip, not the whole video.
 * Returns null when unconfigured or on failure (caller falls back to the full
 * source). Best-effort, never throws.
 */
export async function clipSegment(
  sourceUrl: string,
  startSec: number,
  endSec: number,
  userId?: string,
): Promise<IngestResult | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !sourceUrl || !(endSec > startSec)) return null
  try {
    const res = await fetch(`${base}/clip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({ url: sourceUrl, startSec, endSec, ...(userId ? { userId } : {}) }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string; durationSeconds?: number }
    if (!data?.url || !/^https:\/\//i.test(data.url)) return null
    return { url: data.url, durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : (endSec - startSec) }
  } catch {
    return null
  }
}

/**
 * Render a finished vertical Short on the ingest service in ONE ffmpeg pass:
 * trim [startSec,endSec] → reframe to 1080x1920 → burn Hormozi word-by-word
 * captions (FFmpeg + libass). This is the caption engine Cloudinary can't do.
 * `words` are clip-relative { startSec, endSec, text } cues (word-level ideal).
 * Returns null when unconfigured or on failure (caller falls back to Cloudinary).
 */
/** Render-time layout/tightening options handled by the ingest service.
 *  reframe 'split' = seamless top center-crop over the full horizontal frame. */
export interface RenderShortOpts {
  reframe?: 'center' | 'split'
}

export async function renderShort(
  sourceUrl: string,
  startSec: number,
  endSec: number,
  words: Array<{ startSec: number; endSec: number; text: string; hl?: boolean }>,
  userId?: string,
  captionTheme?: string,
  opts?: RenderShortOpts,
): Promise<IngestResult | null> {
  return renderShortReq({ videoUrl: sourceUrl }, startSec, endSec, words, userId, captionTheme, opts)
}

/**
 * Render a Short by downloading ONLY the [startSec,endSec] window from YouTube
 * (yt-dlp --download-sections), not the whole video — the proxy-bandwidth saver
 * for the fetch path. Same reframe + Hormozi caption burn as renderShort.
 */
export async function renderShortSegment(
  youtubeVideoId: string,
  startSec: number,
  endSec: number,
  words: Array<{ startSec: number; endSec: number; text: string; hl?: boolean }>,
  userId?: string,
  captionTheme?: string,
  opts?: RenderShortOpts,
): Promise<IngestResult | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeVideoId)) return null
  return renderShortReq({ youtubeVideoId }, startSec, endSec, words, userId, captionTheme, opts)
}

async function renderShortReq(
  source: { videoUrl?: string; youtubeVideoId?: string },
  startSec: number,
  endSec: number,
  // `hl` flags a "power word" to accent-color in the burned captions; the render
  // service colors flagged words and renders any emoji present in `text`.
  // Older service builds ignore the extra fields (backward-compatible).
  words: Array<{ startSec: number; endSec: number; text: string; hl?: boolean }>,
  userId?: string,
  captionTheme?: string,
  opts?: RenderShortOpts,
): Promise<IngestResult | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !(endSec > startSec) || (!source.videoUrl && !source.youtubeVideoId)) return null
  setIngestError(null)
  const fromYouTube = !!source.youtubeVideoId && !source.videoUrl

  // On the YouTube-segment path the render can fail because YouTube intermittently
  // blocks the server-side download (the service then reports it as a generic
  // "ffmpeg exited with code 1" once the empty stream reaches ffmpeg). These blocks
  // are often transient, so give the fetch a second attempt before we bail. A real
  // timeout is NOT retried (it would just double a 280s wait). The uploaded-source
  // path renders locally and never needs a retry.
  const maxAttempts = fromYouTube ? 2 : 1
  let lastDetail = 'render request failed'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base}/render-short`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
        },
        // reframe is ignored by older service builds (backward-compatible).
        body: JSON.stringify({
          ...source, startSec, endSec, words: words || [],
          ...(userId ? { userId } : {}),
          ...(opts?.reframe ? { reframe: opts.reframe } : {}),
        }),
        signal: AbortSignal.timeout(280_000),
      })
      if (!res.ok) {
        let body = ''
        try { body = (await res.text()).slice(0, 200) } catch { /* ignore */ }
        // Keep the raw service reason (status + ffmpeg/yt-dlp text) in the logs
        // for debugging, but NEVER show it to the user. On the YouTube path any
        // failure means "we couldn't grab the clip from YouTube" — the fix is
        // always the same (upload the source once), so give one clean message
        // instead of a scary "ffmpeg exited with code 1" dump.
        console.warn('[youtube-ingest] render-short failed', { attempt, status: res.status, fromYouTube, body })
        lastDetail = fromYouTube
          ? 'YouTube didn’t let us grab this clip automatically'
          : `render service ${res.status}${body ? `: ${body}` : ''}`
        if (attempt < maxAttempts) { await new Promise(r => setTimeout(r, 1500)); continue }
        setIngestError(lastDetail)
        return null
      }
      const data = await res.json() as { url?: string; durationSeconds?: number }
      if (!data?.url || !/^https:\/\//i.test(data.url)) { setIngestError('render service returned no video url'); return null }
      return { url: data.url, durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : (endSec - startSec) }
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === 'TimeoutError'
      lastDetail = isTimeout ? 'the render timed out' : (e instanceof Error ? e.message : 'render request failed')
      // Don't retry a genuine timeout — it already ate the full budget.
      if (!isTimeout && attempt < maxAttempts) { await new Promise(r => setTimeout(r, 1500)); continue }
      setIngestError(lastDetail)
      return null
    }
  }
  setIngestError(lastDetail)
  return null
}

/**
 * Download AUDIO ONLY for a YouTube video (tiny vs the full video) and return
 * its hosted URL for transcription. The main proxy-bandwidth saver: we never
 * pull the whole video just to read what was said. Returns null on failure.
 */
export async function ingestAudio(youtubeVideoId: string, userId?: string): Promise<string | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !/^[A-Za-z0-9_-]{11}$/.test(youtubeVideoId)) return null
  try {
    const res = await fetch(`${base}/audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({ videoId: youtubeVideoId, ...(userId ? { userId } : {}) }),
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string }
    return data?.url && /^https:\/\//i.test(data.url) ? data.url : null
  } catch {
    return null
  }
}

// ── CTA burn-in ──────────────────────────────────────────────────────────────
// Burn a branded call-to-action onto a full horizontal video via the ingest
// service (/render-cta). Returns the hosted URL of the rendered video, or null
// when the service isn't configured or the render failed. Uploaded-source only.
export interface CtaSpec {
  text: string
  subtext?: string
  style: 'lowerthird' | 'endcard'
  startSec: number
  endSec: number
}
export async function renderCta(videoUrl: string, cta: CtaSpec, userId?: string): Promise<string | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !videoUrl || !cta.text.trim() || !(cta.endSec > cta.startSec)) return null
  try {
    const res = await fetch(`${base}/render-cta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({
        videoUrl,
        text: cta.text.trim(),
        subtext: (cta.subtext || '').trim(),
        style: cta.style === 'endcard' ? 'endcard' : 'lowerthird',
        startSec: cta.startSec,
        endSec: cta.endSec,
        ...(userId ? { userId } : {}),
      }),
      signal: AbortSignal.timeout(540_000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    return data?.url && /^https:\/\//i.test(data.url) ? (data.url as string) : null
  } catch {
    return null
  }
}

/** Replace a video's audio with a dub track (time-stretched to match length).
 *  Used by Storefront Sync Milestone 2. Returns the hosted dubbed video URL, or
 *  null when the render service isn't configured or the render fails. */
export async function renderDub(
  videoUrl: string,
  audioUrl: string,
  userId?: string,
  durationSec?: number,
): Promise<string | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !/^https:\/\//i.test(videoUrl) || !/^https:\/\//i.test(audioUrl)) return null
  try {
    const res = await fetch(`${base}/dub`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({ videoUrl, audioUrl, ...(userId ? { userId } : {}), ...(durationSec ? { durationSec } : {}) }),
      signal: AbortSignal.timeout(540_000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    return data?.url && /^https:\/\//i.test(data.url) ? (data.url as string) : null
  } catch {
    return null
  }
}
