// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reading the garment judge's answer.
//
// This parser decides whether a creator's thumbnail gets generated a second
// time, so every ambiguous case has to fall on the cheap side. The failure that
// matters is not "we kept a slightly wrong thumbnail". It is a check that reads
// a hedge as a rejection and quietly doubles the image bill on every apparel
// design a creator makes.
//
// So: only an explicit DIFFERENT costs money. Everything else keeps the render.
import { parseGarmentVerdict, GARMENT_CHECK_PROMPT } from '../lib/garment-match'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the three real answers ──────────────────────────────────────────────────
check('MATCH is a match', parseGarmentVerdict('MATCH\nSame navy cable-knit polo.').match === true)
check('DIFFERENT is a miss', parseGarmentVerdict('DIFFERENT\nThe render is a plain pale polo.').match === false)
check('UNSURE is neither', parseGarmentVerdict('UNSURE\nThe garment is mostly hidden.').match === null)

// ── a small model does not answer in the shape you asked for ────────────────
{
  check('a preamble does not hide the verdict',
    parseGarmentVerdict('Looking at these two images, my answer is DIFFERENT — the collar trim is missing.').match === false)
  check('lowercase still counts',
    parseGarmentVerdict('match. the same shirt, just folded differently.').match === true)
  check('the FIRST verdict wins, not the last',
    parseGarmentVerdict('DIFFERENT. The colours do not match, though the collars match.').match === false)
  check('and the other way round too',
    parseGarmentVerdict('MATCH. Same item, only the lighting is different.').match === true)
}

// ── anything unreadable keeps the render ────────────────────────────────────
// Every one of these used to be a plausible way to spend a creator's money.
{
  check('empty is not a rejection', parseGarmentVerdict('').match === null)
  check('null is not a rejection', parseGarmentVerdict(null).match === null)
  check('undefined is not a rejection', parseGarmentVerdict(undefined).match === null)
  check('whitespace is not a rejection', parseGarmentVerdict('   \n  ').match === null)
  check('an unrelated answer is not a rejection',
    parseGarmentVerdict('I cannot help with that request.').match === null)
  check('a refusal is not a rejection',
    parseGarmentVerdict('Sorry, I am unable to analyse images of people.').match === null)
}

// ── the reason survives, for the log and the card ───────────────────────────
{
  const v = parseGarmentVerdict('DIFFERENT\nThe render shows a plain pale polo; the product is navy with a white contrast collar.')
  check('a reason comes back', v.reason.length > 20, v.reason)
  check('and is capped', parseGarmentVerdict(`DIFFERENT\n${'x'.repeat(900)}`).reason.length <= 200)
}

// ── the question only ever asks about the garment ───────────────────────────
// A judge with opinions about the design would start rejecting good thumbnails
// for reasons nobody asked it about.
{
  const p = GARMENT_CHECK_PROMPT
  check('it says to ignore the person', /ignore the person/i.test(p))
  check('it says to ignore the design and text', /background|text/i.test(p))
  check('it lists what actually counts as wrong', /wrong colour/i.test(p) && /contrast collar/i.test(p))
  check('it forgives lighting and folds', /lighting/i.test(p) && /folds/i.test(p))
  check('it forbids guessing', /Do not guess/i.test(p))
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
