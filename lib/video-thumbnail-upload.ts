// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The featured image for a post written from a video, uploaded to WordPress.
// One order, used by the post writer and the heal job alike:
//
//   1. the creator's own blog hero for this video, when they set one
//   2. YouTube's thumbnail, full size, then the smaller one
//   3. the thumbnail MVP made or stored for the video (youtube_videos.thumbnail_url)
//
// Step 3 is what a video that is not public yet needs. YouTube serves no
// thumbnail for a private or scheduled video (404 on both sizes), so a post
// about one had no image at all, and nothing could put one back until the
// video went public. MVP usually holds the thumbnail itself: it made it.
//
// Files are named after the YouTube video, so the duplicate clean-up
// (lib/thumbnail-duplicates) recognises every copy.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wp = any

export async function uploadVideoThumbnail(
  wp: Wp,
  src: { youtubeVideoId: string; customUrl?: string | null; storedUrl?: string | null },
): Promise<{ id: number }> {
  const yt = src.youtubeVideoId
  if (src.customUrl) return wp.uploadImageFromUrl(src.customUrl, `${yt}-blogthumb.jpg`)
  const tries = [
    `https://img.youtube.com/vi/${yt}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
  ]
  const stored = String(src.storedUrl || '').trim()
  // A stored URL that is itself one of YouTube's would fail the same way.
  if (/^https?:\/\//.test(stored) && !/(img\.youtube\.com|i\.ytimg\.com)\/vi\//.test(stored)) tries.push(stored)
  let last: unknown = null
  for (const url of tries) {
    try { return await wp.uploadImageFromUrl(url, `${yt}.jpg`) } catch (e) { last = e }
  }
  throw last instanceof Error ? last : new Error('No thumbnail source could be uploaded')
}
