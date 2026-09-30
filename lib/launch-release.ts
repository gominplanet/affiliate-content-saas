// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A LIFTOFF VIDEO HELD FOR PAID PROMOTION, SCHEDULED THE MOMENT IT CAN BE.
//
// YouTube's API can read paid promotion but not set it, so a batch video is
// uploaded private with no time and waits for Studio (SCOUT's Studio step, or
// the creator ticking it by hand). Once YouTube reads it back as Yes, the time
// the creator planned is set.
//
// This used to happen only in the uploader's check every ten minutes, counted
// from the row's last change. SCOUT saving its Studio run is a change, so a
// video whose paid promotion had just been confirmed sat private for ten more
// minutes, with a row saying it was not scheduled, and looked broken. Saving a
// Studio run now asks at once; the ten-minute check stays for the creator who
// ticks it by hand in Studio.
//
// NOTHING IS SCHEDULED ON SCOUT'S WORD. The answer comes from YouTube itself,
// read through the channel's own login, exactly as the ten-minute check reads
// it. A time that has already gone is not quietly moved: the row says so.

import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
// The reason a held video carries, shared with the page's own rules.
import { HELD_FOR_PAID_PROMOTION } from '@/lib/launch-batch'
export { HELD_FOR_PAID_PROMOTION }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any


/** A time in the batch's own zone, for a sentence. */
export function missedWhen(iso: string, timezone: string | null): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'the time you picked'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' UTC'
  }
}

export type ReleaseResult =
  | { state: 'scheduled'; at: string }
  | { state: 'waiting'; why: 'no-login' | 'not-yet' }
  | { state: 'late' }

export async function releaseHeld(sb: Sb, it: {
  id: string; user_id: string; youtube_video_id: string; planned_publish_at: string | null
}, opts: { channelId: string | null; notify: boolean; zone: string | null }): Promise<ReleaseResult> {
  const stamp = () => new Date().toISOString()
  const videoId = String(it.youtube_video_id)
  const token = await getChannelOAuthToken(sb, it.user_id, opts.channelId)
  if (!token) {
    await sb.from('launch_items').update({ updated_at: stamp() }).eq('id', it.id)
    return { state: 'waiting', why: 'no-login' }
  }
  const yt = new YouTubeOAuthService(token)
  const rb = await yt.readDisclosures(videoId)
  if (rb?.paidPromotion !== true) {
    // Still No. To the back of the line; the ten-minute check looks again.
    await sb.from('launch_items').update({ updated_at: stamp() }).eq('id', it.id)
    return { state: 'waiting', why: 'not-yet' }
  }
  const planned = String(it.planned_publish_at || '')
  const at = Date.parse(planned)
  if (!Number.isFinite(at) || at < Date.now() + 5 * 60_000) {
    await sb.from('launch_items').update({
      reason: `Kept private. Paid promotion is on now, but its time${Number.isFinite(at) ? `, ${missedWhen(planned, opts.zone)},` : ''} has passed, so it was not scheduled. Give it a new time and press Launch these too.`,
      updated_at: stamp(),
    }).eq('id', it.id)
    return { state: 'late' }
  }
  // EVERY STATUS PUT RESENDS WHAT IT MUST KEEP: YouTube erases any status
  // field a PUT leaves out.
  await yt.updateVideoStatus(videoId, {
    publishAt: planned,
    notifySubscribers: opts.notify,
    madeForKids: false,
    embeddable: true,
    containsSyntheticMedia: false,
  })
  await sb.from('launch_items').update({
    state: 'scheduled', publish_at: planned, reason: null, updated_at: stamp(),
  }).eq('id', it.id)
  // The disclosure record, now that it reads Yes. Separate, so a database
  // without migration 368 loses this and nothing else.
  await sb.from('launch_items').update({
    api_disclosures: {
      at: stamp(), asked: true, paidPromotion: true,
      aiUseNo: rb.containsSyntheticMedia === false, embeddable: rb.embeddable, madeForKids: rb.madeForKids,
      error: null, via: 'studio',
    },
  }).eq('id', it.id)
  return { state: 'scheduled', at: planned }
}
