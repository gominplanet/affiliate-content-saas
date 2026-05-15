/**
 * YouTube video MP4 download service — via RapidAPI.
 *
 * We use `youtube-media-downloader` (DataFanatic on RapidAPI) to resolve a
 * YouTube video URL/ID into a direct MP4 stream URL. We can't do this via
 * YouTube's official Data API — they intentionally don't expose file URLs.
 * RapidAPI providers handle the bot-evasion + signature-decoding infra
 * for us, with rate limits and uptime tied to the subscription tier.
 *
 * Required env var:
 *   RAPIDAPI_KEY — single key, works across all RapidAPI services
 *
 * Pricing reference (May 2026): Basic tier ~$5/mo for 10k requests — plenty
 * for MVP usage. Upgrade if hitting limits.
 *
 * Docs:
 *   https://rapidapi.com/DataFanatic/api/youtube-media-downloader
 */

const RAPID_HOST = 'youtube-media-downloader.p.rapidapi.com'
const BASE = `https://${RAPID_HOST}`

/** Extract an 11-character YouTube video ID from any common URL form. */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim()
  // Bare ID (11 chars, alphanumeric + - _)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed
  // Standard watch URL
  const watch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (watch) return watch[1]
  // youtu.be short link
  const short = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (short) return short[1]
  // Shorts URL
  const shorts = trimmed.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/)
  if (shorts) return shorts[1]
  // Embed URL
  const embed = trimmed.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/)
  if (embed) return embed[1]
  return null
}

export interface YouTubeVideoFormat {
  /** Direct MP4 download URL (signed, time-limited — fetch promptly) */
  url: string
  /** Numeric width × height when reported by the API */
  width?: number
  height?: number
  /** "mp4" usually */
  extension?: string
  /** File size in bytes when reported */
  size?: number
  /** Quality label, e.g. "720p", "1080p" */
  qualityLabel?: string
  /** True if the underlying stream has both audio + video muxed */
  hasAudio?: boolean
  hasVideo?: boolean
  /** Bitrate when reported */
  bitrate?: number
}

export interface YouTubeVideoMeta {
  id: string
  title: string
  /** ISO-8601 duration like "PT45S" — we expose it raw; parse if needed */
  duration?: string
  durationSeconds?: number
  thumbnailUrl?: string
  formats: YouTubeVideoFormat[]
}

/**
 * Fetch full video details + available download formats for a YouTube
 * video. Returns the chosen MP4 format(s) plus duration + thumbnail.
 *
 * The DataFanatic service's response shape (v2/video/details endpoint):
 *   {
 *     status: true,
 *     id: "...", title: "...", lengthSeconds: 45,
 *     videos: { items: [{ url, width, height, extension, size, ... }] },
 *     audios: { items: [...] },
 *     thumbnails: [{ url, width, height }],
 *     ...
 *   }
 *
 * We normalize that into our YouTubeVideoMeta shape so callers don't have
 * to know the upstream structure.
 */
export async function getVideoDetails(videoIdOrUrl: string): Promise<YouTubeVideoMeta> {
  const apiKey = process.env.RAPIDAPI_KEY
  if (!apiKey) throw new Error('RAPIDAPI_KEY is not configured on the server')

  const videoId = extractVideoId(videoIdOrUrl)
  if (!videoId) throw new Error(`Could not extract a YouTube video ID from: ${videoIdOrUrl.slice(0, 80)}`)

  const url = `${BASE}/v2/video/details?videoId=${encodeURIComponent(videoId)}`
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': RAPID_HOST,
    },
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`YouTube downloader API failed (HTTP ${res.status}): ${errBody.slice(0, 200)}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  if (data?.status === false || data?.errorId) {
    throw new Error(`YouTube downloader returned error: ${data?.reason ?? data?.errorId ?? 'unknown'}`)
  }

  // Normalize the video format list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawVideoItems: any[] = data?.videos?.items ?? data?.formats ?? []
  const formats: YouTubeVideoFormat[] = rawVideoItems.map(item => ({
    url: item.url,
    width: typeof item.width === 'number' ? item.width : undefined,
    height: typeof item.height === 'number' ? item.height : undefined,
    extension: item.extension || item.container || undefined,
    size: typeof item.size === 'number' ? item.size : undefined,
    qualityLabel: item.qualityLabel || item.quality || undefined,
    hasAudio: item.hasAudio === true,
    hasVideo: item.hasVideo !== false, // assume true unless explicitly false
    bitrate: typeof item.bitrate === 'number' ? item.bitrate : undefined,
  })).filter(f => typeof f.url === 'string')

  const durationSeconds = typeof data?.lengthSeconds === 'number'
    ? data.lengthSeconds
    : typeof data?.duration === 'number'
      ? data.duration
      : undefined

  return {
    id: videoId,
    title: data?.title ?? '',
    duration: data?.duration,
    durationSeconds,
    thumbnailUrl: data?.thumbnails?.[0]?.url ?? data?.thumbnail ?? undefined,
    formats,
  }
}

/**
 * Pick the best MP4 stream for Instagram publishing.
 *
 * Priority order:
 *   1. Muxed (has both audio + video), MP4, vertical (h > w), <= 1080p
 *   2. Muxed, MP4, any orientation, <= 1080p
 *   3. First available MP4
 *
 * Instagram requires MP4 with audio for Reels. We avoid 4K — bigger files,
 * slower download, IG re-encodes anyway. Cap at 1080p source.
 */
export function pickBestFormatForInstagram(formats: YouTubeVideoFormat[]): YouTubeVideoFormat | null {
  if (formats.length === 0) return null

  const mp4 = formats.filter(f => (f.extension ?? 'mp4').toLowerCase() === 'mp4' && f.hasVideo !== false)
  const muxed = mp4.filter(f => f.hasAudio === true)
  const candidatePool = muxed.length > 0 ? muxed : mp4

  // Avoid 4K
  const sensibleSize = candidatePool.filter(f => (f.height ?? 720) <= 1080)
  const pool = sensibleSize.length > 0 ? sensibleSize : candidatePool

  // Prefer vertical
  const vertical = pool.filter(f => f.width && f.height && f.height > f.width)
  if (vertical.length > 0) {
    // Among vertical, prefer highest quality (most likely 1080×1920)
    return vertical.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
  }

  // Fall back to highest quality in pool
  return pool.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
}

/**
 * Download the MP4 bytes from the resolved RapidAPI stream URL.
 *
 * Streaming URLs are time-limited — call this immediately after
 * getVideoDetails. We cap size at 100MB to match the Instagram upload
 * limit and Vercel function payload budget.
 */
export async function downloadMp4(formatUrl: string, maxBytes = 100 * 1024 * 1024): Promise<ArrayBuffer> {
  const res = await fetch(formatUrl)
  if (!res.ok) throw new Error(`Failed to download MP4 (HTTP ${res.status})`)
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10)
  if (contentLength > maxBytes) {
    throw new Error(`Video is ${(contentLength / 1024 / 1024).toFixed(1)}MB — exceeds 100MB limit. Use a shorter or lower-quality source.`)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength > maxBytes) {
    throw new Error(`Video is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — exceeds 100MB limit.`)
  }
  return buf
}
