// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/** Map a youtube_shorts DB row → the client-facing ShortRow. Shared by every
 *  Shorts Studio route so they can't disagree on the shape. */
import type { ShortRow } from '@/lib/shorts-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToShort(r: any): ShortRow {
  return {
    id: r.id,
    videoId: r.video_id,
    youtubeVideoId: r.youtube_video_id ?? null,
    startSec: Number(r.start_sec),
    endSec: Number(r.end_sec),
    hook: r.hook ?? '',
    caption: r.caption ?? '',
    reason: r.reason ?? '',
    score: Number(r.score) || 0,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    subtitles: Array.isArray(r.subtitles) ? r.subtitles : [],
    status: (r.status as ShortRow['status']) ?? 'suggested',
    renderedUrl: r.rendered_url ?? null,
    subtitleStyle: (r.subtitle_style as ShortRow['subtitleStyle']) ?? 'bold-white',
    renderError: r.render_error ?? null,
  }
}
