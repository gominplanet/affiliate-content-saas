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
      // Only call it a YouTube block when the body actually looks like one (bot
      // check / sign-in wall / 403). Other failures (e.g. the render step running
      // out of memory and getting SIGKILL'd) were being mislabelled as a YouTube
      // block, which sent users down the wrong path — surface the real reason.
      const looksBlocked = /confirm you|not a bot|sign in|403|429|consent|login/i.test(body)
      setIngestError(fromYouTube && looksBlocked
        ? `YouTube blocked the automatic download (${res.status})`
        : `render service ${res.status}${body ? `: ${body}` : ''}`)
      return null
    }
    const data = await res.json() as { url?: string; durationSeconds?: number }
    if (!data?.url || !/^https:\/\//i.test(data.url)) { setIngestError('render service returned no video url'); return null }
    return { url: data.url, durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : (endSec - startSec) }
  } catch (e) {
    setIngestError(e instanceof Error && e.name === 'TimeoutError' ? 'the render timed out' : (e instanceof Error ? e.message : 'render request failed'))
    return null
  }
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
