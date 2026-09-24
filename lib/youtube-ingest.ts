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
  /**
   * The audio language actually on the file, when one was requested.
   *
   * null means the request was not made OR was made and not satisfied, and the
   * file therefore carries the ORIGINAL audio. Never set to the language that
   * was asked for: this field exists so a caller can tell the difference
   * between a French dub and an English video about to be published to
   * amazon.fr, which look identical from the URL alone.
   */
  audioLanguage?: string | null
  /** Why the requested language is absent, for a caller that wants to say so. */
  audioLanguageNote?: string | null
}

/** What languages a video already carries, before anything is downloaded. */
export interface AudioTrackInfo {
  languages: string[]
  originalLanguage: string | null
  multiTrack: boolean
}

/**
 * The audio tracks YouTube serves for a video: the creator's own multi-audio
 * uploads and YouTube's auto-dubbing, if either exists.
 *
 * Metadata only, so this is cheap enough to ask before offering a market a free
 * dub. Returns null when unconfigured or on failure, which the caller must read
 * as "we do not know" rather than "there are none": the two lead to opposite
 * decisions, one being "use YouTube's dub" and the other "spend a credit".
 */
export async function listYouTubeAudioTracks(youtubeVideoId: string): Promise<AudioTrackInfo | null> {
  return (await listYouTubeAudioTracksDetailed(youtubeVideoId)).info
}

/**
 * WHY a listing came back empty, because the remedies are different.
 *
 * The first version returned a bare null and the screen turned that into one
 * sentence blaming the downloader's cookies. The real cause on the very first
 * run was something else entirely: the ingest service is a SEPARATE Docker
 * deployment, Vercel does not redeploy it, so /audio-tracks did not exist there
 * yet and the service answered 404. The page told its operator to go and
 * refresh cookies that were perfectly fine.
 *
 * That is the exact failure this page was built to prevent, one layer up. So
 * the causes are separated:
 *
 *   'stale-service'  the endpoint 404s but /health answers, so the service is
 *                    up and running a build older than this feature. Redeploy
 *                    ingest-service.
 *   'service-down'   nothing answers at all.
 *   'unauthorized'   the shared secret does not match.
 *   'blocked'        the service answered and could not read the video, which
 *                    is the cookies / bot-wall case the old message assumed.
 *   'not-configured' YOUTUBE_INGEST_URL is unset.
 */
export type AudioTrackFailure =
  | 'not-configured' | 'service-down' | 'stale-service' | 'unauthorized' | 'blocked'

export async function listYouTubeAudioTracksDetailed(
  youtubeVideoId: string,
): Promise<{ info: AudioTrackInfo | null; reason: AudioTrackFailure | null; detail?: string }> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !youtubeVideoId) return { info: null, reason: 'not-configured' }

  const secret = process.env.YOUTUBE_INGEST_SECRET
  let res: Response
  try {
    res = await fetch(`${base}/audio-tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-ingest-secret': secret } : {}) },
      body: JSON.stringify({ videoId: youtubeVideoId }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (e) {
    return { info: null, reason: 'service-down', detail: e instanceof Error ? e.message : 'unreachable' }
  }

  if (res.status === 401 || res.status === 403) return { info: null, reason: 'unauthorized' }

  // 404 is the interesting one: the service is THERE, it simply predates this
  // endpoint. Confirmed against /health rather than assumed, so "old build" and
  // "wrong URL" stay distinguishable.
  if (res.status === 404) {
    let healthy = false
    try {
      const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) })
      healthy = h.ok
    } catch { /* leave false */ }
    return { info: null, reason: healthy ? 'stale-service' : 'service-down' }
  }

  if (!res.ok) {
    // The service already digs yt-dlp's last ERROR: line out of the verbose
    // stderr and returns it as { error }. Unwrapped here so the screen shows
    // that sentence rather than a JSON envelope around it.
    const body = await res.text().catch(() => '')
    let msg = body
    try {
      const j = JSON.parse(body) as { error?: unknown }
      if (typeof j?.error === 'string' && j.error) msg = j.error
    } catch { /* not JSON, show it raw */ }
    return { info: null, reason: 'blocked', detail: `HTTP ${res.status}: ${msg}`.slice(0, 400) }
  }

  const d = await res.json().catch(() => null) as
    { ok?: boolean; languages?: unknown; originalLanguage?: unknown; multiTrack?: unknown } | null
  if (!d?.ok || !Array.isArray(d.languages)) return { info: null, reason: 'blocked' }

  const languages = d.languages.filter((l): l is string => typeof l === 'string')
  return {
    info: {
      languages,
      originalLanguage: typeof d.originalLanguage === 'string' ? d.originalLanguage : null,
      multiTrack: !!d.multiTrack,
    },
    reason: null,
  }
}

/** Does this video carry a track in `lang`? Prefix match, so 'fr' finds fr-FR. */
export function hasAudioTrack(info: AudioTrackInfo | null, lang: string): boolean {
  if (!info || !lang) return false
  const want = lang.trim().toLowerCase()
  return info.languages.some((l) => l.toLowerCase().startsWith(want))
}

/**
 * Ask the downloader service to fetch a YouTube video and return a hosted MP4
 * URL. Returns null when unconfigured or on any failure — the caller then falls
 * back to prompting the creator to upload the file.
 */
export async function ingestYouTubeVideo(
  youtubeVideoId: string,
  userId?: string,
  /**
   * Ask for a specific audio track, e.g. 'fr' for YouTube's French dub. The
   * service downloads the original instead when the video has no such track,
   * and says so in `audioLanguage` / `audioLanguageNote` on the result. It does
   * NOT fail: the caller can still dub the paid way.
   */
  opts?: { audioLanguage?: string | null },
): Promise<IngestResult | null> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  if (!base || !youtubeVideoId) return null
  const wantLang = (opts?.audioLanguage || '').trim().toLowerCase() || null
  try {
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
      },
      body: JSON.stringify({
        videoId: youtubeVideoId,
        ...(userId ? { userId } : {}),
        ...(wantLang ? { audioLanguage: wantLang } : {}),
      }),
      // Downloading + uploading a long video takes a while; give the service room.
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.ok) return null
    const data = await res.json() as {
      url?: string; durationSeconds?: number; audioLanguage?: unknown; audioLanguageNote?: unknown
    }
    if (!data?.url || !/^https:\/\//i.test(data.url)) return null
    // Read the SERVICE's answer, never echo the request. An older service that
    // does not know the field returns undefined, which becomes null here and
    // correctly reads as "this is the original audio".
    const got = typeof data.audioLanguage === 'string' ? data.audioLanguage : null
    return {
      url: data.url,
      durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : null,
      audioLanguage: got,
      audioLanguageNote: typeof data.audioLanguageNote === 'string'
        ? data.audioLanguageNote
        : (wantLang && !got ? `no ${wantLang} audio track on this video` : null),
    }
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
  // Sticker mode: a designed CTA box (PNG) burned onto the video instead of
  // plain text. When stickerUrl is set the render service overlays it.
  stickerUrl?: string
  widthPct?: number
  position?: string
  // Free placement: the overlay's top-left as a fraction of the frame.
  xPct?: number
  yPct?: number
}
/** Result of a CTA render. `ok:false` carries a short reason so the caller can
 *  tell the creator WHAT went wrong (service not configured, ingest error,
 *  timeout) instead of a single opaque "busy" message. */
export type RenderCtaResult = { ok: true; url: string } | { ok: false; reason: string }

export async function renderCta(videoUrl: string, cta: CtaSpec, userId?: string, timeoutMs = 540_000): Promise<RenderCtaResult> {
  const base = (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '')
  const hasSticker = !!(cta.stickerUrl && /^https:\/\//i.test(cta.stickerUrl))
  if (!base) return { ok: false, reason: 'render-service-not-configured' }
  if (!videoUrl || (!cta.text.trim() && !hasSticker) || !(cta.endSec > cta.startSec)) return { ok: false, reason: 'bad-render-request' }
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
        ...(hasSticker ? { stickerUrl: cta.stickerUrl } : {}),
        ...(cta.widthPct ? { widthPct: cta.widthPct } : {}),
        ...(cta.position ? { position: cta.position } : {}),
        ...(Number.isFinite(cta.xPct) && Number.isFinite(cta.yPct) ? { xPct: cta.xPct, yPct: cta.yPct } : {}),
        ...(userId ? { userId } : {}),
      }),
      // The caller's budget: a background worker cannot wait longer than it
      // is allowed to live, or the answer arrives after nobody is listening.
      signal: AbortSignal.timeout(Math.max(10_000, timeoutMs)),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.error('[renderCta] ingest', res.status, detail)
      return { ok: false, reason: `ingest-${res.status}${detail ? `: ${detail}` : ''}` }
    }
    const data = await res.json().catch(() => ({}))
    if (data?.url && /^https:\/\//i.test(data.url)) return { ok: true, url: data.url as string }
    console.error('[renderCta] ingest 200 but no url', JSON.stringify(data).slice(0, 300))
    return { ok: false, reason: 'ingest-no-url' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[renderCta] fetch failed', msg)
    return { ok: false, reason: /timeout|abort/i.test(msg) ? 'render-timeout' : 'render-unreachable' }
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
