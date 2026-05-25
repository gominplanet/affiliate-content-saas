/**
 * Key-frame grounding for thumbnail generation.
 *
 * Pulls REAL frames from a YouTube video over plain HTTP (no ffmpeg, no
 * yt-dlp, no API quota) so the thumbnail generator can be grounded in the
 * actual person + actual product the creator filmed — which beats text-only
 * prompts on identity, product fidelity, and authenticity (and reinforces the
 * "Experience" E-E-A-T signal). This is the gap our thumbnail competitor's
 * edge was built on.
 *
 * What's available via img.youtube.com (no auth):
 *   - maxresdefault.jpg  1280×720  (the uploader's chosen thumbnail; best res)
 *   - sddefault.jpg       640×480
 *   - hqdefault.jpg       480×360  (always exists)
 *   - mqdefault.jpg       320×180
 *   - 1.jpg / 2.jpg / 3.jpg  120×90  frames sampled at ~25/50/75% of the video
 *
 * maxres/sd can 404 on older or low-res uploads, so we probe and fall back.
 * The mid-video frames (1/2/3) are low-res but capture the product/person in
 * actual use — useful as secondary references even when small.
 */

export type FrameQuality = 'maxresdefault' | 'sddefault' | 'hqdefault' | 'mqdefault'

const HI_RES_ORDER: FrameQuality[] = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault']

/** URL for a specific thumbnail quality. */
export function frameUrl(videoId: string, quality: FrameQuality): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`
}

/** The three mid-video frame captures (~25/50/75%). Low-res (120×90). */
export function midFrameUrls(videoId: string): string[] {
  return [1, 2, 3].map(n => `https://img.youtube.com/vi/${videoId}/${n}.jpg`)
}

/** HEAD-probe a URL; true if it returns a real image (not a 404/placeholder). */
async function frameExists(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    // Missing maxres/sd sometimes 200s with a tiny placeholder; treat very small
    // bodies as "missing" when a length is advertised.
    const len = Number(res.headers.get('content-length') || '0')
    return len === 0 || len > 1500
  } catch {
    return false
  }
}

/**
 * The best available hi-res thumbnail URL for a video (maxres → sd → hq → mq).
 * `hqdefault` effectively always exists, so this resolves for any real video.
 */
export async function resolveBestThumbnail(videoId: string): Promise<string> {
  for (const q of HI_RES_ORDER) {
    const url = frameUrl(videoId, q)
    // eslint-disable-next-line no-await-in-loop
    if (await frameExists(url)) return url
  }
  return frameUrl(videoId, 'hqdefault') // last-resort (almost always present)
}

export interface GroundingFrames {
  /** The single best hi-res frame (the uploader's thumbnail). */
  hero: string
  /** Up to `maxFrames` real frames to feed as image-gen references,
   *  hero first then mid-video captures. */
  references: string[]
}

/**
 * Resolve real frames to ground thumbnail generation. Returns the best hi-res
 * thumbnail plus (optionally) the mid-video frames, all confirmed reachable.
 */
export async function resolveGroundingFrames(
  videoId: string,
  opts: { maxFrames?: number; includeMidFrames?: boolean } = {},
): Promise<GroundingFrames> {
  const maxFrames = opts.maxFrames ?? 4
  const includeMid = opts.includeMidFrames ?? true

  const hero = await resolveBestThumbnail(videoId)
  const references: string[] = [hero]

  if (includeMid && references.length < maxFrames) {
    const mids = midFrameUrls(videoId)
    const checks = await Promise.all(mids.map(u => frameExists(u)))
    for (let i = 0; i < mids.length && references.length < maxFrames; i++) {
      if (checks[i]) references.push(mids[i])
    }
  }

  return { hero, references: references.slice(0, maxFrames) }
}
