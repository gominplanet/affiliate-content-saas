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
 * fetch, with a deadline.
 *
 * Honours a caller-supplied `signal` as well as the timeout, so an existing
 * abort (a request the user navigated away from) still works and simply
 * whichever fires first wins. On timeout the rejection says so in words,
 * because "TimeoutError" alone in a log tells nobody which call gave up.
 */
export async function fetchWithTimeout(input: string | URL | Request, init: TimeoutInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init

  // AbortSignal.any is available on Node 20+. Where a caller passed their own
  // signal we want BOTH, not a choice between them.
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal
    ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal)
    : timeoutSignal

  try {
    return await fetch(input, { ...rest, signal: combined })
  } catch (e) {
    // A timeout surfaces as a bare TimeoutError/AbortError, which in a log line
    // is indistinguishable from a user-cancelled request and names nothing.
    // Say what timed out and after how long.
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const host = (() => { try { return new URL(url).host } catch { return url.slice(0, 60) } })()
      throw new Error(`Request to ${host} timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw e
  }
}
