// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META TELLS US WHY. WE WERE THROWING IT AWAY.
//
// A creator posted to Facebook and Threads in one go. Facebook went out.
// Threads came back with:
//
//   Threads container create failed: An unknown error occurred
//
// and the reasonable next thought, the one he actually had, was "do I need to
// reconnect Threads?" Nothing on the screen could answer that, which is the
// whole problem: a dead token, an image Threads will not accept, and a rate
// limit are three different jobs, and all three printed that sentence.
//
// Meta's error body is not vague. It carries `code`, `error_subcode`,
// `error_user_msg` and `fbtrace_id`, and `code` alone separates an expired
// token (190) from a rate limit (4, 17, 32, 613) from a transient Meta blip
// (1, 2). We read `error.message`, which is the least specific field in the
// object, and dropped the rest.
//
// Worse, "An unknown error occurred" matches none of the patterns in
// lib/channel-health, so the dead-channel detector filed it under "failing"
// rather than "expired". That happens to be RIGHT, and neither the creator nor
// anyone reading the message could tell that it was right rather than a gap.
//
// So this keeps the fields that identify the cause, leads with the one sentence
// the creator can act on when we recognise the code, and when we do not
// recognise it says so plainly instead of dressing a shrug up as a diagnosis.

/** The shape Meta returns on a Graph or Threads API failure. */
export interface MetaErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    fbtrace_id?: string
  }
}

/** Token is dead. The ONLY case where reconnecting is the answer. */
const AUTH_CODES = new Set([190, 102, 463, 467])
/** Too many calls. Waiting fixes it; reconnecting does not. */
const RATE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80003, 80004])
/** Meta's own "something went wrong on our side". */
const TRANSIENT_CODES = new Set([1, 2])

function err(body: unknown): NonNullable<MetaErrorBody['error']> {
  const e = (body as MetaErrorBody | null)?.error
  return (e && typeof e === 'object') ? e : {}
}

/**
 * Is this the one that means reconnect?
 *
 * Deliberately narrow. Telling somebody to reconnect over a rate limit sends
 * them to redo a working connection and leaves the real cause in place, and
 * they will be back tomorrow with the same failure.
 */
export function isMetaAuthError(body: unknown): boolean {
  const e = err(body)
  if (typeof e.code === 'number' && AUTH_CODES.has(e.code)) return true
  if (typeof e.error_subcode === 'number' && AUTH_CODES.has(e.error_subcode)) return true
  return e.type === 'OAuthException'
}

export function isMetaRateLimit(body: unknown): boolean {
  const e = err(body)
  return (typeof e.code === 'number' && RATE_CODES.has(e.code))
    || /rate limit|too many|calls to this api/i.test(e.message ?? '')
}

/**
 * One sentence a creator can act on, followed by what Meta actually said.
 *
 * `network` names the channel ("Threads") and `step` names the stage
 * ("container create"), because the same code means different things at
 * different stages and an unattributable error sent somebody hunting through
 * the wrong half of the flow once already.
 */
export function describeMetaError(network: string, step: string, body: unknown, httpStatus: number): string {
  const e = err(body)
  const code = typeof e.code === 'number' ? e.code : null
  const sub = typeof e.error_subcode === 'number' ? e.error_subcode : null

  // Meta's own user-facing text, when it bothers to write one. It is usually
  // better than anything invented here, so it wins.
  const metaSaid = (e.error_user_msg || '').trim()
  const raw = (e.message || '').trim()

  let lead: string
  if (isMetaAuthError(body)) {
    lead = `Your ${network} connection is no longer valid, so the post was not sent. Reconnect ${network} and try again.`
  } else if (isMetaRateLimit(body)) {
    lead = `${network} is rate limiting this account right now, so the post was not sent. Reconnecting will not help; try again in a little while.`
  } else if (code != null && TRANSIENT_CODES.has(code)) {
    lead = `${network} had a problem on its side and refused the post. Nothing is wrong with your connection. Try again shortly.`
  } else if (metaSaid) {
    lead = `${network} refused the post: ${metaSaid}`
  } else {
    // THE HONEST DEFAULT, and note what it may NOT say.
    //
    // The first draft of this line read "a dead connection says so explicitly",
    // on the reasoning that an expired token returns code 190. A creator hit
    // exactly this branch on Threads, reconnected, and it worked. So a dead
    // Meta token CAN come back as "An unknown error occurred", and that
    // sentence would have talked somebody out of the fix.
    //
    // We cannot tell from here which it is, so this says that, and names the
    // thing that is known to have worked without promising it.
    lead = `${network} refused the post at the ${step} step and did not say why. Reconnecting ${network} is worth trying first: a Meta connection that has gone stale sometimes fails exactly like this instead of saying so.`
  }

  // The diagnostic tail. Small, but it is the difference between guessing at
  // the next occurrence and reading it.
  const parts: string[] = []
  if (raw && !lead.includes(raw)) parts.push(raw)
  if (code != null) parts.push(`code ${code}${sub != null ? `/${sub}` : ''}`)
  else parts.push(`HTTP ${httpStatus}`)
  if (e.fbtrace_id) parts.push(`trace ${e.fbtrace_id}`)

  return `${lead} (${network} ${step}: ${parts.join(', ')})`
}

/**
 * Does this failure mean the creator's connection is dead, as opposed to
 * something that will pass on its own?
 *
 * Asked by the nightly token refresh, where the two outcomes look identical in
 * a log and mean opposite things:
 *
 *   under 24 hours old   Meta refuses to refresh a token that young. Routine,
 *                        self-correcting, happens to every newly connected
 *                        account, and must NEVER surface as "reconnect".
 *   revoked or expired   the account is dead until the creator reconnects, and
 *                        today nothing tells them. It failed nightly, logged to
 *                        a console nobody reads, and the first sign was a post
 *                        failing with a message that named no cause.
 *
 * Errs toward silence. A false "reconnect" sends somebody to redo a working
 * connection, so anything not recognised is left alone rather than guessed at.
 */
export function looksLikeDeadToken(message: string | null | undefined): boolean {
  const m = (message ?? '').toLowerCase()
  if (!m) return false

  // 1. The young-token case, first and unconditionally. Its wording overlaps
  //    with the patterns below ("the access token must be at least 24 hours
  //    old" contains "access token"), and getting it wrong nags every account
  //    the night after it connects.
  if (/24 hours|too (new|young)|not old enough|must be at least/.test(m)) return false

  // 2. Unambiguous auth phrasing, BEFORE the rate-limit exclusion. The sentence
  //    describeMetaError writes for a dead token ends "Reconnect Threads and try
  //    again", and an exclusion on "try again" swallowed it whole: the clearest
  //    dead-token message in the system was classified as alive.
  if (/no longer valid|session (has expired|is invalid)|oauthexception|revoked|code (190|102|463|467)\b/.test(m)) return true

  // 3. Things that pass on their own.
  if (/rate limit|too many|temporarily|try again (in|later|shortly)/.test(m)) return false

  // 4. Weaker signals, only once nothing above has claimed it.
  return /access token|token (is )?(invalid|expired)|expired/.test(m)
}
