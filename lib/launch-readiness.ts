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
  try {
    const { data } = await sb.from('youtube_channels')
      .select('id,oauth_refresh_token').eq('user_id', userId)
      .not('oauth_refresh_token', 'is', null).limit(1)
    return (data ?? []).length > 0
  } catch {
    // UNKNOWN IS NOT BLOCKED. A lookup that failed must not stop a launch that
    // would have worked; the publish step still reports honestly if it cannot
    // get a token.
    return true
  }
}

/** The first reason this batch cannot launch, or null. */
export async function launchReadiness(
  sb: Sb, userId: string, batch: BatchRow, items: ItemRow[],
): Promise<string | null> {
  // THE STEPS FIRST, because "add a video" is more useful than "connect a
  // channel" to somebody who has not added a video.
  const steps = launchBlocker(batch, items)
  if (steps) return steps
  return channelBlocker(await hasPushChannel(sb, userId))
}
