// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The click dashboard may not report a number it did not measure.
//
// Two ways it did. The outer catch returned ok:true with every total set to
// zero, so any failure rendered a dashboard identical to a creator who has
// never had a click. And the query reads at most MAX_ROWS rows newest first,
// so past that point "your last 30 days" quietly becomes "your most recent
// 20,000 clicks" while every total, country split and chart below is computed
// on the truncated set.
//
// Both are the same mistake: a confident answer where there was no answer. A
// creator cannot tell either from a real result, so neither gets investigated.
// The zero especially, because nobody chases a number that says nothing broke.
//
// Neither is currently biting. At the time of writing the busiest account has
// 620 clicks in 30 days, nowhere near the cap. That is exactly why they are
// worth holding in a test: the failure mode only appears once the product is
// working well enough to hit it, which is the worst time to discover it.
import { readFileSync } from 'node:fs'
import { pickLinkStyleDetailed } from '../lib/link-style'
import { join } from 'node:path'
import { truncationNote, coverageNote } from '../lib/passport-analytics-labels'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const ROUTE = readFileSync(join(root, 'app/api/passport/analytics/route.ts'), 'utf8')
const PAGE = readFileSync(join(root, 'app/(dashboard)/passport/page.tsx'), 'utf8')

// ── the truncation sentence ─────────────────────────────────────────────────
{
  check('below the cap says nothing', truncationNote(19_999, 20_000, 30) === null,
    'an account nowhere near the cap must not be nagged')
  check('at the cap it speaks up', truncationNote(20_000, 20_000, 30) !== null)
  check('over the cap it speaks up', truncationNote(25_000, 20_000, 30) !== null)
  check('zero clicks says nothing', truncationNote(0, 20_000, 30) === null)

  const note = truncationNote(20_000, 20_000, 30) || ''
  check('it names the cap', /20,000/.test(note))
  check('it names the period it could not cover', /30 days/.test(note))
  check('and tells them what to do instead', /shorter period/i.test(note),
    'a caveat with no way out is just an apology')
  check('it does not claim the totals are right', !/accurate|complete|exact totals below/i.test(note))

  // The two notes are joined, so neither may swallow the other.
  const both = [truncationNote(20_000, 20_000, 30), coverageNote({ known: 5, unclassified: 5 })].filter(Boolean)
  check('truncation and coverage can both be said at once', both.length === 2,
    'they caveat different things and a reader needs both')
}

// ── the route must not answer a failure with zeros ──────────────────────────
{
  const tail = ROUTE.slice(ROUTE.lastIndexOf('} catch'))
  check('the catch is findable', tail.length > 0)
  check('a failure is not reported as ok:true',
    !/ok: true/.test(tail),
    'returning ok:true with zeros here is what made a broken dashboard look like an empty one')
  check('a failure says ok:false', /ok: false/.test(tail))
  check('and carries a message the page can show', /error:/.test(tail))
  check('the reason reaches the logs', /console\.error/.test(tail),
    'the bare catch left nothing to diagnose from afterwards')
  check('the message denies the zero reading',
    /not a sign that your links have no clicks/.test(tail),
    'the one thing a creator would otherwise assume')

  // The unreadable-table path is a different case: the page still renders, but
  // it must not pass its placeholder zeros off as measurements.
  check('an unreadable table is flagged rather than shown as zero',
    /unavailable: true/.test(ROUTE))
  check('and it is logged', /click table unreadable/.test(ROUTE))
}

// ── the page has to actually show it ────────────────────────────────────────
// A distinguishable API response that the UI renders as zeros anyway would fix
// nothing. This is the half that the creator sees.
{
  check('the page keeps the failure', /loadError/.test(PAGE))
  check('it separates a failed load from an empty account',
    /setLoadError\(/.test(PAGE) && /j\?\.ok/.test(PAGE))
  check('it surfaces the unavailable flag too', /j\.unavailable/.test(PAGE))
  check('the banner is rendered', /Click data did not load/.test(PAGE))
  check('and offers a retry', /Try again/.test(PAGE),
    'a dead end tells someone their data is gone rather than late')
}

// ── a style we took away is not a style she chose ───────────────────────────
//
// Reported 2026-09-15. A creator's saved link style was Geniuslink, her API
// credentials went missing, and pickLinkStyle downgraded her to 'direct'. The
// downgrade is correct: a plain link beats no link. It was also invisible, and
// worse than invisible, because 'direct' is indistinguishable from a creator who
// WANTS plain links, so every layer above behaved correctly for a decision she
// never made. She had been hand-editing her own published Facebook posts for
// days.
//
// The day before, the reason a FAILED Geniuslink wrap was made visible. It did
// not help her: her style had already been downgraded before any wrap was
// attempted, so the new message stayed silent. The fix was one layer above the
// bug, which is the shape of mistake this file exists to catch.
{
  const cases: Array<[string, Parameters<typeof pickLinkStyleDetailed>[0], string | null]> = [
    ['saved geniuslink, credentials gone',
      { passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: false }, 'geniuslink'],
    ['saved bitly, no token',
      { passportEligible: false, mode: 'bitly', hasBitly: false, hasGeniuslink: false }, 'bitly'],
    // The other side. Reporting these would cry wolf on everyone who is fine.
    ['saved geniuslink, credentials present',
      { passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: true }, null],
    ['chose direct on purpose',
      { passportEligible: false, mode: 'direct', hasBitly: false, hasGeniuslink: false }, null],
    ['never chose anything',
      { passportEligible: false, mode: '', hasBitly: false, hasGeniuslink: false }, null],
  ]
  for (const [label, input, expected] of cases) {
    const got = pickLinkStyleDetailed(input).downgradedFrom
    check(`${label} -> downgradedFrom ${expected ?? 'null'}`, got === expected, `got ${got ?? 'null'}`)
  }

  // And the resolver has to ACT on it, or the field is decoration.
  const CLOAK = readFileSync('lib/link-cloak.ts', 'utf8')
  check('a downgraded style is reported as a failure',
    /cfg\.downgradedFrom\s*\n?\s*\? \{ url: dest, reason: 'style-downgraded', cloaked: false \}/.test(CLOAK),
    'without this, direct-because-we-downgraded-you stays as silent as direct-because-she-chose-it')
  check('and a chosen direct still says nothing',
    /: \{ url: dest, reason: 'direct', cloaked: true \}/.test(CLOAK),
    'a warning on every plain-link creator is a warning nobody reads')
  check('the message names the fix, not the symptom',
    /Re-enter them under External Integrations/.test(CLOAK),
    '"links are going out plain" sends somebody to the wrong screen')
}



console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)