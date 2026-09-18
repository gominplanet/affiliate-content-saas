// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The current year never appears in a generated title. And the product's own
// model year always survives.
//
// Both halves came off the SAME screenshot, which is why this file exists:
//
//   strip:  "Back to School sale Deal: Kismile Nugget Ice Maker Countertop,
//            33LBS/24H Ice... (2026)"          ← invented by the writer
//   keep:   "Snailax 2026 Upgraded Neck and Back Massager"
//                          ↑ the manufacturer's model year, part of the name
//
// A stripper that catches the first and not the second is the whole job.
// Getting the second wrong corrupts a product name, breaks the match between
// the post and the listing, and reads as a bug to the creator, so the false
// positives below matter more than the true positives.
import { readFileSync } from 'node:fs'
import { stripTitleYear, stripSlugYear, hasDecorativeYear, candidateYears } from '../lib/title-year'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// Fixed date so the suite means the same thing next January.
const NOW = new Date('2026-09-15T12:00:00Z')
const strip = (s: string) => stripTitleYear(s, NOW)

// ── the window ─────────────────────────────────────────────────────────────
{
  const ys = candidateYears(NOW)
  check('the current year is a candidate', ys.includes(2026))
  check('so is last year', ys.includes(2025), 'a post written in December and published in January')
  check('and the next two', ys.includes(2027) && ys.includes(2028),
    '"Best X for 2027" gets written in the autumn')
  check('but not the distant past', !ys.includes(2019),
    'a 4-digit number that far off is a product name, not an SEO stamp')
  check('and not the distant future', !ys.includes(2035))
}

// ── THE ONES THAT MUST BE STRIPPED ─────────────────────────────────────────
{
  const cases: Array<[string, string]> = [
    ['Back to School sale Deal: Kismile Nugget Ice Maker Countertop, 33LBS/24H Ice Machine (2026)',
     'Back to School sale Deal: Kismile Nugget Ice Maker Countertop, 33LBS/24H Ice Machine'],
    ['Best Nugget Ice Makers 2026', 'Best Nugget Ice Makers'],
    ['Best Nugget Ice Makers - 2026', 'Best Nugget Ice Makers'],
    ['Best Nugget Ice Makers: 2026', 'Best Nugget Ice Makers'],
    ['Best Nugget Ice Makers | 2026', 'Best Nugget Ice Makers'],
    ['The Best Ice Makers for 2026', 'The Best Ice Makers'],
    ['The Best Ice Makers in 2026', 'The Best Ice Makers'],
    ['Top 10 Massagers [2026]', 'Top 10 Massagers'],
    ['(2026) Best Ice Makers', 'Best Ice Makers'],
    ['Best Ice Makers 2026 (2026)', 'Best Ice Makers'],
    ['Best Ice Makers 2025', 'Best Ice Makers'],
    ['Best Ice Makers for 2027', 'Best Ice Makers'],
    // A LEADING stamp. A model year belongs after the brand ("Snailax 2026"),
    // never before it, so a title that opens on a bare year is decoration.
    ['2026 Ice Maker Buying Guide', 'Ice Maker Buying Guide'],
    ['2026: Ice Maker Buying Guide', 'Ice Maker Buying Guide'],
    // The Edition idiom. Removing only the year would leave "Best Ice Makers
    // Edition", so the whole phrase goes.
    ['Best Ice Makers 2026 Edition', 'Best Ice Makers'],
    ['Best Ice Makers - 2026 Update', 'Best Ice Makers'],
  ]
  for (const [input, want] of cases) {
    const got = strip(input)
    check(`strips: ${input.slice(0, 52)}`, got === want, `got "${got}", wanted "${want}"`)
    check(`no year survives: ${input.slice(0, 40)}`, !/\b(2025|2026|2027|2028)\b/.test(got), got)
  }
}

// ── THE ONES THAT MUST SURVIVE (this is the risky half) ────────────────────
{
  const keep = [
    // The actual product from the same screenshot.
    'Snailax 2026 Upgraded Neck and Back Massager, Massage Chair Pad with Heat',
    'Snailax 2026 Upgraded Neck and Back Massager',
    // Mid-title model years of the same shape.
    'The Ninja 2026 Creami Review',
    'Is the Dyson 2026 Airwrap Worth It?',
    'Kismile 2026 Ice Maker vs the 2025 Model Compared',
    // Numbers that are not years at all.
    'Best 4000 Lumen Projectors',
    'A 1080p Webcam Worth Buying',
    'The 33LBS/24H Ice Machine Explained',
    // Years outside the window: old model names must not be touched.
    'The Best Laptops of 2014, Revisited',
    'Nintendo 64 Nostalgia Picks',
  ]
  for (const t of keep) {
    check(`keeps intact: ${t.slice(0, 48)}`, strip(t) === t, `got "${strip(t)}"`)
  }
}

// ── nothing is destroyed ───────────────────────────────────────────────────
{
  check('a title that is only a year is left alone', strip('2026') === '2026',
    'stripping it leaves nothing, and an empty title is worse than a bad one')
  check('empty in, empty out', strip('') === '')
  check('null is safe', stripTitleYear(null, NOW) === '')
  check('whitespace is trimmed', strip('  Best Ice Makers 2026  ') === 'Best Ice Makers')
  check('no doubled spaces are left', !/\s{2,}/.test(strip('Best (2026) Ice Makers')))
  check('and the sentence still reads', strip('Best (2026) Ice Makers') === 'Best Ice Makers',
    'a bracketed year mid-title leaves a gap that has to close')
  check('a dangling separator is removed', strip('Best Ice Makers |  2026') === 'Best Ice Makers')
  check('repeated calls are stable', strip(strip('Best Ice Makers 2026')) === 'Best Ice Makers',
    'titles get re-scrubbed on regenerate and must not erode')
}

// ── the reporting helper ───────────────────────────────────────────────────
{
  check('a decorated title is detected', hasDecorativeYear('Best Ice Makers 2026', NOW))
  check('the Snailax product is NOT flagged',
    !hasDecorativeYear('Snailax 2026 Upgraded Neck and Back Massager', NOW),
    'flagging it would send somebody to "fix" a correct title')
  check('a clean title is not flagged', !hasDecorativeYear('Best Ice Makers', NOW))
}

// ── slugs ──────────────────────────────────────────────────────────────────
{
  check('a trailing slug year goes',
    stripSlugYear('back-to-school-kismile-nugget-ice-maker-countertop-33lbs-24h-ice-2026', NOW)
      === 'back-to-school-kismile-nugget-ice-maker-countertop-33lbs-24h-ice')
  check('a mid-slug model year stays',
    stripSlugYear('snailax-2026-upgraded-neck-and-back-massager', NOW)
      === 'snailax-2026-upgraded-neck-and-back-massager',
    'same trade as the title: only a trailing year is decoration')
  check('a year outside the window stays', stripSlugYear('best-laptops-2014', NOW) === 'best-laptops-2014')
  check('no trailing hyphen is left', !stripSlugYear('best-ice-makers-2026', NOW).endsWith('-'))
}

// ── the rule is enforced where titles are made, not only in source greps ───
//
// scripts/test-pricing-copy already bans the pattern in SOURCE. It cannot
// catch a model that writes "(2026)" itself, which is exactly what happened.
{
  const LIB = readFileSync('lib/title-year.ts', 'utf8')
  check('the stripper takes an injectable now', /now: Date = new Date\(\)/.test(LIB),
    'otherwise the suite means something different every January')
  check('and only anchors trailing years', /\\\\s\*\$/.test(LIB) || /\$`/.test(LIB),
    'a mid-title match is what would eat the Snailax model year')
}

// ── ONE stripper, and the over-eager copy is gone ──────────────────────────
//
// app/api/blog/comparison carried its own, ending with
// `.replace(/\\b20[0-3]\\d\\b/g, '')` — "any remaining standalone year" — which
// stripped a year from ANYWHERE. Live, it published "Snailax Upgraded Neck and
// Back Massager" and "Kismile Ice Maker vs the Model Compared", and it ran over
// meta_description too, where a year in a sentence is perfectly legitimate.
{
  const CMP = readFileSync('app/api/blog/comparison/route.ts', 'utf8')
  check('the comparison route no longer defines its own', !/function stripYear\(/.test(CMP),
    'two strippers drift, and the one that drifts is the one nobody is reading')
  check('and uses the shared one', /from '@\/lib\/title-year'/.test(CMP))
  // Comment lines are stripped FIRST. The removal is documented with the old
  // regex quoted verbatim so the next reader knows what it did, and any check
  // that greps the raw file flags that explanation as the bug itself. Two
  // earlier attempts here did exactly that and failed on correct code.
  const cmpCode = CMP.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('the catch-all year replace is gone from the CODE',
    !/20\[0-3\]/.test(cmpCode),
    'that call is what ate the manufacturer model year out of product names')

  const GEN = readFileSync('app/api/blog/generate/route.ts', 'utf8')
  check('the blog writer strips its title', /stripTitleYear\(scrubBanned\(generated\.title\)\)/.test(GEN),
    'it had no stripper at all, and its titles are written by the model')
  check('but NOT the excerpt', !/stripTitleYear\(scrubBanned\(generated\.excerpt/.test(GEN),
    'a year in a sentence is legitimate; this layer must not touch prose')
}

// ── decoration that sits MID-title ─────────────────────────────────────────
//
// The rules originally reached only a leading, trailing, or bracket-only year,
// and an audit of 37 live titles found 12 missed. Every miss was decoration in
// the middle, in front of a subtitle. These pin the widening; the KEEP cases
// below pin the thing the widening must never cost.
{
  const cases: [string, string][] = [
    ['Best Robotic Pool Vacuums in 2026: Beatbot vs ECOVACS', 'Best Robotic Pool Vacuums: Beatbot vs ECOVACS'],
    ['Best Vacuums in 2026: 5 Models Tested', 'Best Vacuums: 5 Models Tested'],
    ['Tracki Pro GPS Tracker Review: Worth It in 2025?', 'Tracki Pro GPS Tracker Review: Worth It?'],
    ['Best All-In-One Pool Cleaners 2026 Guide', 'Best All-In-One Pool Cleaners Guide'],
    ['Best Pool Vacuum for Inground Pools 2026 Premium Showdown', 'Best Pool Vacuum for Inground Pools Premium Showdown'],
    ['Best Pool Vacuum for Inground Pools 2026: Mid-Range Showdown', 'Best Pool Vacuum for Inground Pools: Mid-Range Showdown'],
    ['Tidify Car Front Seat Organizer [2025 UPDATED]: Is It Best?', 'Tidify Car Front Seat Organizer: Is It Best?'],
    ['Best Pool Toys for Summer 2026 (Ranked)', 'Best Pool Toys for Summer (Ranked)'],
  ]
  for (const [input, want] of cases) {
    check(`mid-title: "${input.slice(0, 44)}"`, strip(input) === want, `got "${strip(input)}"`)
  }
}

// ── and the widening costs nothing it should not ───────────────────────────
//
// THE FIRST VERSION OF THE DECORATION-NOUN RULE FAILED HERE, which is the whole
// reason these are written down. It allowed "Review" and "Compared" in its noun
// list with a wildcard adjective in between, so it reached across a product
// name to a trailing Review:
//
//   "The Ninja 2026 Creami Review"  ->  "The Ninja Creami Review"
//
// Review is the most common last word on this site, so that one allowance made
// a model year reachable from half the titles in the database. The rule is now
// limited to our own roundup furniture and to titles opening with "Best".
{
  const keep = [
    'Snailax 2026 Upgraded Neck and Back Massager',
    'The Ninja 2026 Creami Review',
    'Youtube video: 2026 Christmas Decor Trends to Watch',
    'Sony 2026 Model Camera Review',
    // Starts with "Best", so the Best-prefix guard does NOT protect it. This
    // is the case that pins the noun list itself: break-testing showed that
    // putting Review back in the list leaked past every other keep-case here,
    // because they all begin with something other than Best.
    'Best Ninja 2026 Creami Review',
  ]
  for (const k of keep) {
    check(`untouched: "${k.slice(0, 44)}"`, strip(k) === k, `got "${strip(k)}"`)
  }
  // A year that IS the subject rather than a stamp: after a colon, in front of
  // the noun it describes. The one mid-title position nothing above may touch.
  check('a year that is the topic survives',
    strip('Youtube video: 2026 Christmas Decor Trends to Watch').includes('2026'))
}

if (failures.length) {
  console.error(`\n❌ title-year: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ title-year: an invented year comes off the title and the slug, and a product’s own model year survives')
