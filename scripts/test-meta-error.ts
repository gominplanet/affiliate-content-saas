// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META'S ERROR BODY SAYS WHY. WE WERE READING THE ONE FIELD THAT DOES NOT.
//
// A creator posted to Facebook and Threads together. Facebook went out. Threads
// came back with:
//
//   Threads container create failed: An unknown error occurred
//
// He asked the only question that message supports, which is "do I need to
// reconnect Threads?", and nothing on the screen could answer it. He reconnected
// on a hunch. It worked.
//
// Two things were wrong, and the second is the reason this file exists.
//
// WE DISCARDED THE ANSWER. Meta returns `code`, `error_subcode`,
// `error_user_msg` and `fbtrace_id`. `code` alone separates a dead token (190)
// from a rate limit (4, 17, 32, 613) from a transient Meta fault (1, 2). We read
// `error.message` and threw the rest away, so every cause printed the same
// sentence.
//
// AND I GUESSED, IN CODE. The first draft of the unknown-cause branch said "a
// dead connection says so explicitly", reasoning that an expired token returns
// 190. His reconnect disproved it: a stale Meta token CAN surface as "An unknown
// error occurred". That sentence would have talked the next person out of the
// fix that works. The branch now says we cannot tell and names reconnecting as
// worth trying, which is what the evidence supports.
//
// So the classifier is pinned here against the real bodies, and the two ways it
// can do harm are pinned hardest: calling a working connection dead, and calling
// a dead one fine.
import {
  describeMetaError,
  isMetaAuthError,
  isMetaRateLimit,
  looksLikeDeadToken,
} from '../lib/meta-error'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

function body(fields: Record<string, unknown>): { error: Record<string, unknown> } {
  return { error: fields }
}

// ── a dead token is named as one, and says what to do ─────────────────────
{
  const expired = body({
    message: 'Error validating access token: Session has expired',
    type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'Axy123',
  })
  check('code 190 is an auth error', isMetaAuthError(expired))
  const msg = describeMetaError('Threads', 'container create', expired, 400)
  check('and the creator is told to reconnect', /reconnect threads/i.test(msg), msg)
  check('and it says the post was not sent', /not sent/i.test(msg), msg)
  check('and the code survives for whoever reads the log next', /code 190\/463/.test(msg), msg)
  check('and the trace id does too', /Axy123/.test(msg), msg)

  check('an OAuthException with no code still counts',
    isMetaAuthError(body({ type: 'OAuthException', message: 'bad token' })))

  // And the code ALONE, with no type. Without this the two signals cover for
  // each other: emptying AUTH_CODES entirely still passed, because every body
  // tested here also carried type: 'OAuthException'.
  check('code 190 alone is enough',
    isMetaAuthError(body({ code: 190, message: 'Error validating access token' })),
    'the numeric code is the signal Meta always sends; the type is not')
  check('subcode 463 alone is enough',
    isMetaAuthError(body({ error_subcode: 463, message: 'session expired' })))
}

// ── a rate limit is NOT a reconnect, and says so out loud ─────────────────
//
// This is the expensive false positive. Sending somebody to redo a working
// connection wastes their time, leaves the real cause in place, and brings them
// back tomorrow with the same failure.
{
  const limited = body({ message: 'Application request limit reached', code: 4, fbtrace_id: 'Bzz' })
  check('code 4 is a rate limit', isMetaRateLimit(limited))
  check('and NOT an auth error', !isMetaAuthError(limited))
  const msg = describeMetaError('Instagram', 'container create', limited, 400)
  check('the message says reconnecting will not help',
    /reconnecting will not help/i.test(msg), msg)
  check('and does not tell them to reconnect', !/reconnect instagram and try/i.test(msg), msg)
}

// ── a transient Meta fault is not the creator's problem ───────────────────
{
  const blip = body({ message: 'An unexpected error has occurred', code: 2 })
  const msg = describeMetaError('Threads', 'publish', blip, 500)
  check('a code 2 is described as Meta\'s side', /on its side/i.test(msg), msg)
  check('and reassures them about their connection',
    /nothing is wrong with your connection/i.test(msg), msg)
}

// ── THE ONE THAT ACTUALLY HAPPENED ────────────────────────────────────────
//
// No code, no subcode, Meta's vaguest message. The classifier knows nothing and
// has to say so without either accusing the connection or clearing it.
{
  const unknown = body({ message: 'An unknown error occurred' })
  const msg = describeMetaError('Threads', 'container create', unknown, 500)

  check('it admits it does not know', /did not say why/i.test(msg), msg)
  check('and still names the step', /container create/i.test(msg), msg)
  check('and keeps Meta\'s own words', /an unknown error occurred/i.test(msg), msg)

  // The correction. This exact body preceded a reconnect that fixed it, so the
  // message must not rule that out.
  check('it does NOT claim the connection is fine',
    !/not a sign your connection is broken/i.test(msg),
    'a stale Meta token surfaced exactly like this and reconnecting fixed it; that sentence would talk the next person out of it')
  check('and it suggests reconnecting', /reconnecting threads is worth trying/i.test(msg), msg)
  check('without promising it', /sometimes/i.test(msg),
    'we do not know that it is the cause, and saying so flatly would be the same guess in the other direction')
}

// ── an empty or broken body never throws ──────────────────────────────────
//
// This runs inside a failure path. A classifier that throws there replaces a
// bad error message with no error message.
{
  for (const junk of [null, undefined, {}, { error: null }, 'a string', 42, []]) {
    let out = ''
    try { out = describeMetaError('Threads', 'publish', junk, 500) } catch (e) {
      check(`describeMetaError survives ${JSON.stringify(junk)}`, false, String(e))
      continue
    }
    check(`${JSON.stringify(junk)} still produces a sentence`, out.length > 20, out)
    check(`${JSON.stringify(junk)} still names the network`, /Threads/.test(out), out)
    check(`and is not treated as auth`, !isMetaAuthError(junk))
  }
}

// ── looksLikeDeadToken: the nightly refresh's question ────────────────────
//
// Wrong in one direction it nags every freshly connected account to reconnect;
// wrong in the other a creator posts into the void for weeks.
{
  const dead = [
    'Your Threads connection is no longer valid, so the post was not sent. Reconnect Threads and try again. (Threads token refresh: code 190)',
    'Error validating access token: Session has expired',
    'The access token has been revoked',
    'OAuthException: invalid token',
  ]
  for (const m of dead) check(`dead: "${m.slice(0, 40)}…"`, looksLikeDeadToken(m))

  const notDead = [
    // The routine one. Meta refuses to refresh a token under 24 hours old, which
    // happens to EVERY account the night after it connects.
    'Threads token refresh failed: The access token must be at least 24 hours old',
    'token is too new to refresh',
    'Application request limit reached, try again later',
    'Threads is rate limiting this account right now',
    'fetch failed',
    '',
    null,
    undefined,
  ]
  for (const m of notDead) {
    check(`not dead: "${String(m).slice(0, 44)}…"`, !looksLikeDeadToken(m),
      'marking this dead would tell somebody with a working connection to redo it')
  }

  // The specific overlap that makes this worth testing: the young-token message
  // contains "access token", which is one of the dead patterns.
  check('"access token" alone does not make it dead',
    !looksLikeDeadToken('The access token must be at least 24 hours old'),
    'the young-token case has to be excluded BEFORE the generic patterns run')
}

// ── house style on anything a creator reads ───────────────────────────────
{
  const samples = [
    describeMetaError('Threads', 'container create', body({ message: 'An unknown error occurred' }), 500),
    describeMetaError('Threads', 'publish', body({ code: 190, type: 'OAuthException', message: 'expired' }), 400),
    describeMetaError('Instagram', 'container create', body({ code: 4, message: 'limit' }), 400),
    describeMetaError('Threads', 'publish', body({ code: 2, message: 'oops' }), 500),
  ]
  for (const s of samples) {
    check(`no dash punctuation in "${s.slice(0, 36)}…"`, !/[—–]|\s-\s/.test(s))
    check(`no year in "${s.slice(0, 36)}…"`, !/\b20\d{2}\b/.test(s))
  }
}

if (failures.length) {
  console.error(`\n❌ meta-error: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ meta-error: a dead token, a rate limit and an unknown cause are three different sentences')
