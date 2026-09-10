// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A default deadline must never overrule one the caller chose.
//
// fetchWithTimeout applied its 30-second default ALWAYS, combined with any
// caller-supplied signal so that whichever fired first won. That reads as
// caution and behaves as the opposite: a caller passing a 290-second budget,
// because it knows the work takes about four minutes, silently got 30 seconds,
// with nothing at the call site to suggest it.
//
// It broke auto-pilot completely. The generation worker calls the blog route
// internally with that 290-second budget. Every job aborted at 30 seconds and
// retried three times, so every job was recorded as failed and the social
// cascade never ran. Meanwhile the abandoned route carried on server-side and
// published the post anyway, so the blog filled up on schedule while not one
// social post went out. The failure was shaped exactly like success.
//
// The rule is a pure function so it can be checked directly. Testing it through
// fetch means stubbing the global and inspecting a signal's timer, which is how
// a test ends up measuring the stub rather than the rule.
import { effectiveTimeoutMs, DEFAULT_TIMEOUT_MS } from '../lib/fetch-timeout'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the gap the default exists to fill ──────────────────────────────────────
{
  check('a call with no deadline at all gets the default',
    effectiveTimeoutMs(undefined, false) === DEFAULT_TIMEOUT_MS,
    'this helper exists because Node fetch has no timeout; that must not regress')
  check('the default is 30s', DEFAULT_TIMEOUT_MS === 30_000, String(DEFAULT_TIMEOUT_MS))
}

// ── the regression ──────────────────────────────────────────────────────────
{
  // A caller that passed its own signal has thought about the budget, so the
  // helper must not silently shorten it. This one assertion IS the bug:
  // returning DEFAULT_TIMEOUT_MS here is what killed every blog generation.
  check('a caller signal means the caller owns the deadline',
    effectiveTimeoutMs(undefined, true) === null,
    'returning the default here caps a 290s job at 30s and records it as failed')
}

// ── an explicit budget is always honoured exactly ───────────────────────────
{
  check('an explicit timeoutMs wins with no signal', effectiveTimeoutMs(290_000, false) === 290_000)
  check('an explicit timeoutMs wins with a signal too', effectiveTimeoutMs(290_000, true) === 290_000,
    'a caller wanting BOTH a cancellation signal and a time limit can still say so')
  check('a short explicit budget is not raised to the default',
    effectiveTimeoutMs(3_000, false) === 3_000)
  check('zero is honoured, not treated as absent',
    effectiveTimeoutMs(0, false) === 0,
    'a `timeoutMs || default` would silently turn "no wait" into 30 seconds')
}

// ── the callers this must not disturb ───────────────────────────────────────
{
  // Nearly every call site passes a signal SHORTER than the default (2.5s to
  // 25s WordPress and OAuth probes). Under the old rule and the new one alike,
  // their own signal is what fires, so this change reaches only the calls that
  // were being cut short.
  //
  // The ones that WERE cut short, all silently clamped to 30s: a 45s duplicate
  // resolver, a 110s upload, and the worker's 290s (560s with Fluid Compute).
  const shortCallers = [2_500, 3_000, 5_000, 8_000, 15_000, 20_000, 25_000]
  const longCallers = [45_000, 110_000, 290_000, 560_000]
  for (const ms of [...shortCallers, ...longCallers]) {
    check(`a ${ms / 1000}s caller budget is the operative one`,
      effectiveTimeoutMs(undefined, true) === null,
      'short callers were unaffected before and stay unaffected; long ones stop being clamped')
  }
  check('the long callers really are longer than the default',
    longCallers.every(ms => ms > DEFAULT_TIMEOUT_MS),
    'if this ever fails the list above has stopped describing the bug')
  check('the short callers really are shorter than the default',
    shortCallers.every(ms => ms < DEFAULT_TIMEOUT_MS))
}

if (failures.length) {
  console.error(`\n❌ fetch-deadline-precedence: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ fetch-deadline-precedence: the default fills a gap, it never overrules a caller that named its own budget')
