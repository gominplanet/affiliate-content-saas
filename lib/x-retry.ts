// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE RE-ATTEMPT PER FAILED X POST, THEN MVP DROPS IT (Seb, 2026-10-05).
//
// X bills every request, failed ones included ($0.20 each, see lib/x-cap), and
// a refunded failure gives the creator their slot back, so before this a post
// X kept refusing could be sent again and again: by the scheduler's transient
// requeue (twice more), by its 401 refresh, and by every click on "Post to X".
// Each one was money with nothing to show for it.
//
// Now every X post has a key (the scheduled row, the blog post, the deal) and
// at most X_ATTEMPTS_PER_POST requests are ever sent for it: the first try and
// one re-attempt. Each failed request leaves a zero-cost marker row in ai_usage
// (feature 'x_attempt_failed', model = the key), so the count survives across
// cron ticks and page reloads. The $0.20 itself stays on the 'x_post_failed'
// row refundXPost leaves, priced as 'twitter-api'. A post that has failed twice
// is refused before anything reaches X, with a message that says so.
//
// Some failures cannot be fixed by sending the same thing again (duplicate
// text, a malformed request, X's own daily limit), so those are not re-sent:
// the re-attempt would be a charge for a known answer.

import { createAdminClient } from '@/lib/supabase/admin'
import { reserveXPost, refundXPost, xCapMessage } from '@/lib/x-cap'

export const X_ATTEMPTS_PER_POST = 2
export const X_ATTEMPT_FAILED_FEATURE = 'x_attempt_failed'

/** The tag a failed attempt carries in ai_usage.model. */
export function xPostKey(kind: 'scheduled' | 'blog' | 'deal', id: string): string {
  return `post:${kind}:${id}`
}

/** True when sending the same post again could succeed. Pure. */
export function xFailureWorthRetry(message: string): boolean {
  if (/^RATE_LIMIT:/.test(message)) return false // X's daily limit: a re-send gets the same answer
  if (/duplicate/i.test(message)) return false // X refuses identical text
  if (/tweet failed \((400|403|404|413|422)\)/i.test(message)) return false // the request itself is wrong
  if (/not connected|needs reconnecting|reconnect X|X posts for this billing period/i.test(message)) return false
  return true
}

/** How many X requests for this post have already failed. Fails open (0). */
export async function xFailedAttempts(userId: string, key: string): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (createAdminClient() as any).from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', X_ATTEMPT_FAILED_FEATURE).eq('model', key)
    return count ?? 0
  } catch { return 0 }
}

/** Count one failed X request for this post. Awaited, so the next check sees
 *  it. Zero cost: model is the key (not priced) and images is 0. */
export async function markXAttemptFailed(userId: string, key: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createAdminClient() as any).from('ai_usage').insert({
      user_id: userId, feature: X_ATTEMPT_FAILED_FEATURE, model: key,
      input_tokens: 0, output_tokens: 0, web_searches: 0, images: 0,
    })
  } catch { /* the count is a brake, never a reason to fail */ }
}

/** The refusal for a post that has used its re-attempt. */
export function xDroppedMessage(lastError?: string): string {
  return `X refused this post twice, so MVP dropped it and will not send it to X again.${lastError ? ` X said: ${lastError.slice(0, 200)}` : ''}`
}

/** True when a duplicate refusal followed a failure that may have reached X
 *  (a timeout or a dropped connection): the first try may well be live. */
export function xMayHavePosted(firstError: string, secondError: string): boolean {
  return /duplicate/i.test(secondError) && /timeout|timed out|aborted|socket|ECONNRESET|fetch failed|\b5\d\d\b/i.test(firstError)
}

/** An X send that ended without a post. `sent` is true when at least one
 *  request reached X (and was charged), which is what tells the scheduler not
 *  to requeue it: the re-attempt has already happened here. */
export class XPostError extends Error {
  constructor(message: string, readonly sent: boolean, readonly dropped: boolean) { super(message) }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Send one X post under the rule: at most X_ATTEMPTS_PER_POST requests for
 * this key, ever. Reserves a cap slot before each request and refunds it when
 * the request fails (lib/x-cap), counts every failure (markXAttemptFailed),
 * and makes the one re-attempt right here after a short pause.
 *
 * `tweet` makes the request. It is told the previous error on the re-attempt,
 * so a caller can refresh a token after a 401 before sending again.
 */
export async function postToXWithOneRetry<T>(o: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string
  key: string
  tweet: (previousError: string | null) => Promise<T>
  pauseMs?: number
}): Promise<T> {
  let failures = await xFailedAttempts(o.userId, o.key)
  if (failures >= X_ATTEMPTS_PER_POST) throw new XPostError(xDroppedMessage(), false, true)
  let previous: string | null = null
  let first: string | null = null
  let sent = false
  for (;;) {
    const res = await reserveXPost(o.supabase, o.userId)
    if (!res.ok) throw new XPostError(xCapMessage(res.resetLabel, res.limit ?? undefined), sent, false)
    try {
      return await o.tweet(previous)
    } catch (e) {
      sent = true
      await refundXPost(o.supabase, res.reservationId) // the slot comes back, the $0.20 stays on the books
      await markXAttemptFailed(o.userId, o.key)
      failures++
      const m = errText(e)
      first = first ?? m
      if (failures >= X_ATTEMPTS_PER_POST) {
        const maybe = previous && xMayHavePosted(first, m)
          ? ' The first try may have gone through before the connection dropped, so check your X profile before posting it again.'
          : ''
        throw new XPostError(xDroppedMessage(m) + maybe, true, true)
      }
      if (!xFailureWorthRetry(m)) {
        throw new XPostError(`${m} MVP did not send it again, since X would give the same answer.`, true, false)
      }
      previous = m
      await new Promise((r) => setTimeout(r, o.pauseMs ?? 3000))
    }
  }
}
