// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE ONE PLACE THAT DECIDES A JOB TIMED OUT.
//
// A timeout on the worker's internal call to the generate route is not an
// ordinary failure, and the difference is a duplicate post.
//
// The route runs in its OWN serverless invocation. It never learns that the
// worker hung up, so when the worker's deadline fires the route carries on and
// publishes. Requeue the job and a second full generation runs beside the first,
// and both publish. Leave it alone and the stale-claim window re-runs it only if
// it truly died, updating the post in place.
//
// So the worker tags a timeout and treats it differently. That tagging was in
// place, correct, and had not fired once since 2026-09-08:
//
//   fetch-timeout   caught undici's TimeoutError and rethrew `new Error(msg)`
//                   to say which host and which budget. A plain Error is named
//                   "Error".
//   job-runner      recognised a timeout with `e.name === 'TimeoutError'`.
//   cron worker     recognised the runner's tag with /^TIMEOUT/i.
//
// Every line individually correct, and the first one silently unmade the second.
// Timeouts fell through to the ordinary-failure branch, which requeues. A
// creator got three near-identical posts a minute apart, two days running.
//
// The two ends matched by literal, so nothing could notice they had stopped
// agreeing. They now share this module: the runner produces the tag here, the
// worker reads it here, and a test drives a real timed-out fetch through both.
import { isTimeoutError } from '@/lib/fetch-timeout'

/** The prefix the worker looks for. Never written out by hand anywhere else. */
export const TIMEOUT_TAG = 'TIMEOUT:'

/**
 * A tagged error when `err` was a deadline, or null when it was anything else.
 *
 * Null matters as much as the tag. Treating every failure as a timeout would
 * leave genuinely broken jobs sitting in 'running' until the stale window, which
 * is ten minutes of a creator watching a spinner for something that failed in
 * two seconds.
 */
export function tagIfTimeout(err: unknown, label: string): Error | null {
  if (!isTimeoutError(err)) return null
  return new Error(`${TIMEOUT_TAG} ${label} exceeded the worker budget`, { cause: err })
}

/** Does this message carry the tag? The worker's half of the seam. */
export function isTaggedTimeout(message: string): boolean {
  return message.trimStart().toUpperCase().startsWith(TIMEOUT_TAG)
}
