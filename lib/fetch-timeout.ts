// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// fetch with a deadline, because half of ours had none.
//
// 157 of the 317 server-side fetch calls passed no signal. Node's fetch has no
// default timeout, so a slow WordPress site or a social API that accepts the
// connection and then goes quiet holds the serverless function open until
// `maxDuration`, which on the generation routes is 300 seconds. The creator
// watches a spinner that will never resolve, and the function bills for every
// second of it.
//
// A hung call is worse than a failed one in every way that matters here: it
// costs more, it tells the user nothing, and it retries nothing. This gives
// every call an upper bound and a readable error when it is hit.

/** Default ceiling for an ordinary API call. Generous enough that a slow but
 *  working provider still succeeds, short enough that a dead one gives the
 *  route time to fall back or report. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Upload-shaped calls: publishing media, posting a video container. These do
 *  real work on the other side, so they get longer before we give up. */
export const UPLOAD_TIMEOUT_MS = 120_000

export interface TimeoutInit extends RequestInit {
  /** Milliseconds before the request is aborted. Defaults to
   *  DEFAULT_TIMEOUT_MS. Pass UPLOAD_TIMEOUT_MS for media publishing. */
  timeoutMs?: number
}

/**
 * The timeout this call will actually run under, in ms, or null when the
 * caller's own signal is the only deadline.
 *
 * Pulled out as a pure function because it is the rule that broke, and a rule
 * buried inside a fetch wrapper can only be checked by stubbing the network.
 *
 *   no signal, no timeoutMs  → the default, which is why this helper exists
 *   signal, no timeoutMs     → null: the caller named their budget, respect it
 *   timeoutMs (either way)   → exactly what was asked for
 */
export function effectiveTimeoutMs(timeoutMs: number | undefined, hasCallerSignal: boolean): number | null {
  if (typeof timeoutMs === 'number') return timeoutMs
  return hasCallerSignal ? null : DEFAULT_TIMEOUT_MS
}

/** The host part of a URL, for an error message. Falls back to a short prefix of
 *  whatever was passed, because an unparseable input still needs naming. */
export function hostOf(input: string | URL | Request): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  try { return new URL(url).host } catch { return String(url).slice(0, 60) }
}

/** Turn a network failure into a sentence that names the host and the cause,
 *  or null when this is not that kind of error.
 *
 *  Node's fetch throws `TypeError: fetch failed` for every transport problem:
 *  DNS, refused connection, TLS, reset mid-body. The real reason is on `.cause`
 *  and the message names neither it nor the host. A creator ran Fix all
 *  affiliate links across 34 posts, every one failed, and the report read
 *  "First error: <post id>: fetch failed" — which does not say whether their
 *  WordPress site was unreachable, a redirect could not be followed, or the link
 *  service was down. Three different fixes, one indistinguishable message.
 *
 *  Pure, so the wording is pinned by tests rather than by a stubbed network. */
export function describeFetchFailure(err: unknown, input: string | URL | Request): string | null {
  if (!(err instanceof Error)) return null
  if (!/fetch failed|network|socket|ECONN|EAI_AGAIN|ENOTFOUND/i.test(err.message)) return null
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  const detail = (cause?.code || cause?.message || '').toString().trim()
  return `Could not reach ${hostOf(input)}${detail ? ` (${detail.slice(0, 120)})` : ''}`
}

/**
 * fetch, with a deadline.
 *
 * THE DEFAULT ONLY APPLIES WHEN THE CALLER SET NO DEADLINE OF THEIR OWN.
 *
 * It used to apply always, combined with any caller signal so that whichever
 * fired first won. That reads as caution and is the opposite. A caller passing
 * `signal: AbortSignal.timeout(290_000)` has thought about how long the work
 * takes; silently capping it at 30 seconds overrules that with a number chosen
 * for ordinary API calls, and the caller cannot tell, because the shorter signal
 * simply wins.
 *
 * It cost a real feature. The generation worker calls the blog route internally
 * with a 290-second budget because generating and publishing a post takes around
 * four minutes. Under the always-on default every one of those died at 30
 * seconds and retried three times. The worker recorded the job as failed, so the
 * auto-pilot social cascade never ran, while the route it had abandoned carried
 * on server-side and published the post anyway. Auto-pilot looked like it worked
 * and posted to no socials at all, for days, and nothing said otherwise.
 *
 * So: a caller-supplied `signal` is now the deadline. `timeoutMs` still applies
 * alongside it when explicitly passed, for a caller that wants both an abort
 * signal (navigation, cancellation) and a time limit. Callers with a signal
 * SHORTER than the default are unaffected either way, which is nearly all of
 * them; the ones this changes are exactly the ones that were being cut short.
 */
export async function fetchWithTimeout(input: string | URL | Request, init: TimeoutInit = {}): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init

  const effectiveTimeout = effectiveTimeoutMs(timeoutMs, !!signal)
  const timeoutSignal = effectiveTimeout == null ? null : AbortSignal.timeout(effectiveTimeout)
  // AbortSignal.any is available on Node 20+.
  const combined = signal && timeoutSignal
    ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal)
    : (signal ?? timeoutSignal)

  try {
    return await fetch(input, { ...rest, signal: combined ?? undefined })
  } catch (e) {
    // A timeout surfaces as a bare TimeoutError/AbortError, which in a log line
    // is indistinguishable from a user-cancelled request and names nothing.
    // Say what timed out and after how long.
    // A transport failure names the host and the real cause. Undici's bare
    // "fetch failed" is what made a 34-post batch report nothing actionable.
    const network = describeFetchFailure(e, input)
    if (network) throw new Error(network, { cause: e })
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      const host = hostOf(input)
      // Name the budget that was actually in force. Reporting the default when
      // the caller's own signal is what fired sends whoever reads the log
      // hunting for a 30-second setting that was never involved.
      const budget = effectiveTimeout ?? null
      throw new Error(budget == null
        ? `Request to ${host} was aborted by its caller's deadline`
        : `Request to ${host} timed out after ${Math.round(budget / 1000)}s`)
    }
    throw e
  }
}
