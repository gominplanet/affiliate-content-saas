// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A HARD RULE: MVP writes posts only from videos the public can watch.
//
// Auto-pilot published a review of the eero Pro 6E a day before its video
// went live, and Zaperly and Ninja ten days before theirs: posts embedding a
// video nobody could play, with no thumbnail, because YouTube serves none for
// a private or scheduled video. The rule lives here and is asked by the post
// writer itself (app/api/blog/generate, which auto-pilot, the Generate button,
// Schedule publish and the job queue all go through) and by comparison posts.
//
// "Public" is what YouTube says (videos.list with the public key returns only
// public and unlisted videos). When YouTube cannot be asked, the video's own
// publish time decides: a time in the future is a scheduled video. Unlisted is
// not public: nobody finds it, and a post is written to be found.

import { videoVisibility } from '@/lib/covered-sales'

export type NotPublic = { youtubeVideoId: string; reason: 'scheduled' | 'private' | 'unlisted'; goesLiveAt: string | null }

export async function videosNotPublic(
  videos: Array<{ youtubeVideoId: string; publishedAt?: string | null }>,
): Promise<NotPublic[]> {
  const list = videos.filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.youtubeVideoId))
  if (!list.length) return []
  const seen = await videoVisibility(process.env.YOUTUBE_API_KEY, list.map((v) => v.youtubeVideoId))
  const now = Date.now()
  const out: NotPublic[] = []
  for (const v of list) {
    const future = !!v.publishedAt && new Date(v.publishedAt).getTime() > now
    const vis = seen.get(v.youtubeVideoId)
    if (vis === 'public' && !future) continue
    if (vis === undefined && !future) continue // YouTube not asked: the date said it is out
    out.push({
      youtubeVideoId: v.youtubeVideoId,
      reason: future ? 'scheduled' : vis === 'unlisted' ? 'unlisted' : 'private',
      goesLiveAt: future ? v.publishedAt ?? null : null,
    })
  }
  return out
}

/** The sentence a creator reads. */
export function notPublicMessage(n: NotPublic, title?: string | null): string {
  const what = title ? `"${title.slice(0, 80)}"` : 'This video'
  if (n.reason === 'scheduled' && n.goesLiveAt) {
    const when = new Date(n.goesLiveAt).toUTCString().replace(/:\d\d GMT$/, ' UTC')
    return `${what} is scheduled on YouTube and goes public ${when}. MVP only writes posts from public videos, so it was not written. Generate it once the video is live.`
  }
  if (n.reason === 'unlisted') return `${what} is unlisted on YouTube. MVP only writes posts from public videos, so it was not written. Make it public on YouTube, then generate it.`
  return `${what} is not public on YouTube (private, or scheduled). MVP only writes posts from public videos, so it was not written. Generate it once the video is live.`
}
