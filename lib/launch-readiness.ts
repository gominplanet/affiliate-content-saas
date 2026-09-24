// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Everything that stops a batch launching, worked out in one place.
//
// WHY IT IS ONE PLACE. The page enables the Launch button and the launch route
// refuses it, and those two using different code is not a hypothetical: it
// happened last week, when one of them fetched a column the other did not and
// a finished batch was refused with a message about a step that was done.
//
// So the rules are a pure function over the rows, and the one thing that needs
// a lookup lives here with it, and both callers call this.

import { launchBlocker, channelBlocker, type BatchRow, type ItemRow } from '@/lib/launch-batch'
import { scheduleItems, datesBeforeToday } from '@/lib/launch-schedule'

/**
 * A video set for a day that has already gone.
 *
 * THE LAUNCH ROUTE REFUSED THIS AND THE PAGE DID NOT KNOW. A batch set up
 * yesterday with yesterday as its first day showed an enabled Launch button,
 * and pressing it got a refusal. The same check now runs here, so the button
 * and the route say the same thing before anybody presses it. Only the videos
 * the uploader does not already have are looked at: a launched batch's past
 * days are history, not a mistake.
 */
function pastDates(batch: BatchRow, items: ItemRow[]): string | null {
  const open = items.filter((i) => i.state === 'prepared' && !i.planned_publish_at)
  if (open.length === 0) return null
  const plan = { timezone: batch.timezone || 'UTC', slots: batch.daily_slots ?? [], startOn: batch.start_on ?? '' }
  const schedule = scheduleItems(items.map((i) => ({ id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time })), plan)
  const planned = open.map((i) => schedule.get(i.id)).filter((p): p is NonNullable<typeof p> => !!p)
  const stale = datesBeforeToday(planned, plan.timezone)
  if (stale.length === 0) return null
  const which = open.filter((i) => stale.some((x) => x.id === i.id)).map((i) => `Video ${i.position + 1}`)
  return `${which.join(', ')} ${which.length === 1 ? 'is' : 'are'} set for a day that has already gone. Pick today to send ${which.length === 1 ? 'it' : 'them'} out now, or a later day.`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/**
 * Can this creator push to YouTube at all.
 *
 * A channel can be connected PULL-ONLY: added by its URL so we can read its
 * uploads, with no OAuth tokens stored. That channel cannot receive an upload,
 * and treating "a channel exists" as "we can publish" is what turns a missing
 * connection into three failed tries per video.
 */
export async function hasPushChannel(sb: Sb, userId: string): Promise<boolean> {
  // THE UPLOADER'S OWN RULE, not a looser one. It publishes through the
  // DEFAULT channel when that channel has a login, and only otherwise through
  // the older account-level login (lib/youtube-channels getChannelOAuthToken).
  // This used to pass if ANY channel had a login, so a creator whose default
  // was added by URL only got an enabled Launch and then three failed tries
  // per video; and it refused older accounts whose only login is the
  // account-level one, which the uploader would have used happily.
  //
  // UNKNOWN IS NOT BLOCKED. supabase-js returns errors rather than throwing
  // them, so a failed lookup used to read as "no channel". Any error now means
  // "could not tell", which lets the launch through; the upload still reports
  // honestly if it cannot get a token.
  const { data: def, error: defErr } = await sb.from('youtube_channels')
    .select('oauth_access_token,oauth_refresh_token').eq('user_id', userId).eq('is_default', true).maybeSingle()
  if (defErr) return true
  if (def?.oauth_access_token) return !!def.oauth_refresh_token
  const { data: legacy, error: legErr } = await sb.from('integrations')
    .select('youtube_oauth_access_token,youtube_oauth_refresh_token').eq('user_id', userId).maybeSingle()
  if (legErr) return true
  return !!(legacy?.youtube_oauth_access_token && legacy?.youtube_oauth_refresh_token)
}

/** The first reason this batch cannot launch, or null. */
export async function launchReadiness(
  sb: Sb, userId: string, batch: BatchRow, items: ItemRow[],
): Promise<string | null> {
  // THE STEPS FIRST, because "add a video" is more useful than "connect a
  // channel" to somebody who has not added a video.
  const steps = launchBlocker(batch, items)
  if (steps) return steps
  // AMAZON ONLY: no YouTube channel is needed and there is no schedule to be
  // in the past. Asking for either would block a launch that needs neither.
  if (batch.send_to_youtube === false) return null
  const dates = pastDates(batch, items)
  if (dates) return dates
  return channelBlocker(await hasPushChannel(sb, userId))
}
