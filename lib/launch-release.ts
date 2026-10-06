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
import { studioDid, scoutSawPaidPromotion } from '@/lib/studio-upload'
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
  | { state: 'published' }
  | { state: 'waiting'; why: 'no-login' | 'not-yet' | 'youtube-quota' }
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
  // WHEN YOUTUBE CANNOT BE ASKED, STUDIO'S OWN READING COUNTS (2026-10-05).
  // On a day the shared quota is used up this read fails, and a video SCOUT
  // had disclosed and scheduled in Studio stayed held on a read that never
  // happened. SCOUT reads Paid promotion and the schedule back from Studio's
  // saved state; that releases it here, with no YouTube call at all. A read
  // that does answer still decides, as below.
  let rb: Awaited<ReturnType<typeof yt.readDisclosures>>
  try {
    rb = await yt.readDisclosures(videoId)
  } catch (e) {
    const said = e instanceof Error ? e.message : String(e)
    if (!/quota|dailyLimitExceeded/i.test(said)) throw e
    const { data: row } = await sb.from('launch_items').select('studio_upload').eq('id', it.id).maybeSingle()
    const raw = row?.studio_upload ?? null
    const did = raw ? studioDid(raw, (raw as { visibility?: unknown }).visibility != null) : null
    const planned = String(it.planned_publish_at || '')
    const scoutScheduled = !!did && did.visibility === 'schedule' && !!did.publishAt
      && Date.parse(did.publishAt) > Date.now()
      && (!planned || Math.abs(Date.parse(did.publishAt) - Date.parse(planned)) <= 120_000)
    const scoutPaid = !!raw && scoutSawPaidPromotion(raw)
    if (scoutPaid && scoutScheduled) {
      await sb.from('launch_items').update({ state: 'scheduled', publish_at: did!.publishAt, reason: null, updated_at: stamp() }).eq('id', it.id)
      await commentFollows(sb, it.user_id, videoId, did!.publishAt!)
      return { state: 'scheduled', at: did!.publishAt! }
    }
    // SAVED PRIVATE IN STUDIO, ITS TIME GONE: the same "late" as a read that
    // answers, with no call needed, so the creator can give it a new time now
    // instead of waiting for the allowance to come back to be told that.
    const at = Date.parse(planned)
    const { data: nowRow } = await sb.from('launch_items').select('publish_now').eq('id', it.id).maybeSingle()
    if (scoutPaid && did?.visibility && nowRow?.publish_now !== true && (!Number.isFinite(at) || at < Date.now() + 5 * 60_000)) {
      await sb.from('launch_items').update({
        reason: `Kept private. Paid promotion is on (SCOUT read it back in Studio), but its time${Number.isFinite(at) ? `, ${missedWhen(planned, opts.zone)},` : ''} has passed, so it was not scheduled. Give it a new time and press Launch these too.`,
        updated_at: stamp(),
      }).eq('id', it.id)
      return { state: 'late' }
    }
    // Otherwise it waits for the allowance, and says so rather than "YouTube
    // did not confirm", which it never got to ask. The start of the note is
    // kept: it is how the held check finds the row.
    await sb.from('launch_items').update({
      reason: (scoutPaid
        ? `${HELD_FOR_PAID_PROMOTION} yet: YouTube's daily allowance for API calls is used up, so MVP could not ask. SCOUT read Paid promotion: Yes in Studio, and MVP sets its time as soon as the allowance resets at midnight Pacific.`
        : `${HELD_FOR_PAID_PROMOTION} yet: YouTube's daily allowance for API calls is used up, so MVP could not ask${raw ? ', and SCOUT did not read Paid promotion: Yes in Studio either' : ''}. MVP asks again after midnight Pacific. To finish sooner, tick Paid promotion in Studio and make it public or scheduled there.`
      ).slice(0, 400),
      updated_at: stamp(),
    }).eq('id', it.id)
    return { state: 'waiting', why: 'youtube-quota' }
  }
  // WHAT YOUTUBE SAYS COMES FIRST. The held message tells the creator they
  // can finish in Studio; if they did, the row follows YouTube rather than
  // overwriting it. Public is public; a time set in Studio is the time.
  if (rb?.privacyStatus === 'public') {
    await sb.from('launch_items').update({ state: 'published', reason: null, updated_at: stamp() }).eq('id', it.id)
    await commentFollows(sb, it.user_id, videoId, stamp())
    return { state: 'published' }
  }
  if (rb?.privacyStatus === 'private' && rb.publishAt && Date.parse(rb.publishAt) > Date.now()) {
    await sb.from('launch_items').update({ state: 'scheduled', publish_at: rb.publishAt, reason: null, updated_at: stamp() }).eq('id', it.id)
    await commentFollows(sb, it.user_id, videoId, rb.publishAt)
    return { state: 'scheduled', at: rb.publishAt }
  }
  if (rb?.paidPromotion !== true) {
    // Still No. To the back of the line; the ten-minute check looks again.
    await sb.from('launch_items').update({ updated_at: stamp() }).eq('id', it.id)
    return { state: 'waiting', why: 'not-yet' }
  }
  const planned = String(it.planned_publish_at || '')
  const at = Date.parse(planned)
  // "Send now" was the choice: a past time is the point, not a miss.
  const { data: now } = await sb.from('launch_items').select('publish_now').eq('id', it.id).maybeSingle()
  // ONLY WHILE "NOW" IS STILL THE PLAN. A video given a new, later time after
  // it was held kept its old "send now" flag, and this made it public hours
  // before the time the creator had just chosen. A planned time still ahead
  // wins over the flag.
  if (now?.publish_now === true && !(Number.isFinite(at) && at > Date.now() + 5 * 60_000)) {
    await yt.updateVideoStatus(videoId, {
      privacyStatus: 'public', publishAt: null, notifySubscribers: opts.notify,
      madeForKids: false, embeddable: true, containsSyntheticMedia: false,
    })
    await sb.from('launch_items').update({ state: 'published', reason: null, updated_at: stamp() }).eq('id', it.id)
    await commentFollows(sb, it.user_id, videoId, stamp())
    return { state: 'published' }
  }
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
  await commentFollows(sb, it.user_id, videoId, planned)
  // The disclosure record, now that it reads Yes. Separate, so a database
  // without migration 368 loses this and nothing else.
  await sb.from('launch_items').update({
    api_disclosures: {
      at: stamp(), asked: true, paidPromotion: true,
      aiUseNo: rb.containsSyntheticMedia != null ? rb.containsSyntheticMedia === false : null, aiUse: rb.containsSyntheticMedia ?? null, embeddable: rb.embeddable, madeForKids: rb.madeForKids,
      error: null, via: 'studio',
    },
  }).eq('id', it.id)
  return { state: 'scheduled', at: planned }
}


/**
 * Is a video held for paid promotion due another look? Each look costs from
 * the shared YouTube quota, so they are often only near the planned time.
 * Pure.
 *   no planned time (going out now once disclosed)      every 30 minutes
 *   within two hours of the planned time                every 10 minutes
 *   further ahead, or up to a day past                  every hour
 *   up to two weeks past                                every 6 hours
 *   older                                               once a day
 */
export function heldCheckDue(plannedIso: string | null, lastIso: string | null, now = Date.now()): boolean {
  const last = lastIso ? Date.parse(lastIso) : NaN
  if (!Number.isFinite(last)) return true
  const since = now - last
  const planned = plannedIso ? Date.parse(plannedIso) : NaN
  if (!Number.isFinite(planned)) return since >= 30 * 60_000
  const off = now - planned
  const every = Math.abs(off) <= 2 * 3_600_000 ? 10 * 60_000
    : off < 86_400_000 ? 3_600_000
    : off < 14 * 86_400_000 ? 6 * 3_600_000
    : 86_400_000
  return since >= every
}

/** The video's first comment follows its new time. Queued while the video was
 *  held, it had no time and was looked at only every six hours, so it landed
 *  up to six hours after the video went public. Allowed to fail. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function commentFollows(sb: any, userId: string, videoId: string, at: string): Promise<void> {
  try {
    await sb.from('video_first_comments').update({ publish_at: at, last_checked_at: null })
      .eq('user_id', userId).eq('youtube_video_id', videoId).eq('state', 'waiting')
  } catch { /* the six-hour check still posts it */ }
}
