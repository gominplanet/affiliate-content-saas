// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MOVING A SCHEDULED POST TOUCHES TWO CLOCKS, AND ONLY ONE OF THEM PUBLISHES.
//
// PATCH /api/blog/schedule-edit writes the new time to blog_posts.scheduled_for
// AND asks WordPress to move the post's own date. WordPress is what actually
// publishes a wp-native post. The WP call was wrapped in a try/catch whose only
// consequence was a console.warn, so when it failed:
//
//   MVP's schedule       moved
//   WordPress's schedule did not
//   the screen said      "Schedule updated"
//   the post published   at the ORIGINAL time
//
// A console.warn is the same as silence. Nobody reads a log line for a request
// that returned 200, which is exactly how the Geniuslink fallback and the
// Passport mint failure both hid for weeks in this codebase.
//
// Failing is fine and must stay best-effort: MVP's own row has already moved,
// and a hard throw would leave a worse mess. What changes is that the caller is
// told, ok goes false, and the modal stays open.
//
// The 30 second question this came out of: a WP write tries the body-auth proxy
// first, which aborts at 30s (lib/wp-proxy), then falls through to Basic Auth
// at 45s, and a 401 sends it round once more for another 45s. This route
// declared no maxDuration at all, so on a slow host the platform default could
// kill it AFTER scheduled_for had moved and BEFORE the social cascade shifted,
// leaving the post and its socials on different times.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ROUTE = readFileSync('app/api/blog/schedule-edit/route.ts', 'utf8')
const MODAL = readFileSync('components/content/ScheduleEditModal.tsx', 'utf8')

// ── the route reports a half-applied reschedule ────────────────────────────
{
  check('a failed WP reschedule is captured', /wpWarning = /.test(ROUTE),
    'a console.warn on a 200 response is the same as silence')
  check('and returned to the caller', /wpWarning,/.test(ROUTE))
  check('and it is NOT reported as ok', /ok: !wpWarning/.test(ROUTE),
    'every MVP-side write succeeding is not the same as the post moving; WordPress is what publishes')
  check('a timeout reads differently from a refusal',
    /abort\|timeout\|timed out/.test(ROUTE),
    'a slow host and a rejected date need different advice')
  check('a missing WP connection is its own message', /WordPress is not connected for this site/.test(ROUTE),
    'silently skipping the WP write when there are no credentials is the same bug with a different cause')
  check('the message says what will actually happen',
    (ROUTE.match(/still publishes at its original time/g) || []).length >= 3,
    'the creator needs the consequence, not the cause')
  check('the WP call is still best-effort', /catch \(e\) \{/.test(ROUTE),
    'MVP’s own row has already moved; throwing here would leave a worse mess')
}

// ── the route is bounded ───────────────────────────────────────────────────
{
  const m = ROUTE.match(/export const maxDuration = (\d+)/)
  check('the route declares a maxDuration', !!m,
    'undeclared, it inherits the platform default, and a WP write can run 30s + 45s + 45s on a slow host')
  const secs = m ? parseInt(m[1], 10) : 0
  check('long enough for the worst WP path', secs >= 120,
    `${secs}s: the proxy leg is 30s, Basic Auth 45s, and a 401 retry another 45s`)
}

// ── the screen does not say "updated" when it was not ──────────────────────
{
  check('the modal reads the warning', /d\.wpWarning/.test(MODAL))
  check('and shows it as an error, not a note', /toast\.error\(d\.wpWarning/.test(MODAL),
    'a toast.message next to a green success is read as a detail, not a failure')
  check('and does NOT then claim success',
    /toast\.error\(d\.wpWarning[\s\S]{0,200}?return[\s\S]{0,120}?toast\.success\('Schedule updated'\)/.test(MODAL),
    'the early return is what stops the green toast firing underneath the red one')
  check('and the modal stays open', /setSaving\(false\)\s*\n\s*return/.test(MODAL),
    'closing it would strand the creator with no way back to the control that failed')
}

if (failures.length) {
  console.error(`\n❌ schedule-edit-honesty: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ schedule-edit-honesty: a reschedule WordPress did not take is reported as a failure, not as "Schedule updated"')
