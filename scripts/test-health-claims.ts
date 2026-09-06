// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the health-claim guard catch supplement copy?
//
// It did not. MVP generated the thumbnail headline "DOES THIS ACTUAL BOOST YOUR
// ENERGY???" for a beef organ supplement and published it to the creator's
// Facebook page. The guard was already looking for "boost", and boost was in its
// claim-verb list, but the subject list only knew about conditions: eczema,
// migraines, blood sugar. It had no idea that energy, testosterone, stamina,
// recovery and digestion are the entire vocabulary of supplement marketing, and
// the exact vocabulary the FTC and Amazon police hardest.
//
// The rule is Seb's and it is absolute: no health or medical claim anywhere MVP
// generates copy, and a question is not an exception. So the assertions below
// come in pairs. Every supplement claim has to be caught, and every ordinary
// product sentence that happens to share a word with one has to survive, because
// a guard that eats "supports 4K" or "energy efficient" would get switched off.
import { hasHealthClaim, scrubHealthClaims, scrubBanned } from '../lib/scrub'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the headline that shipped ───────────────────────────────────────────────
{
  const shipped = 'DOES THIS ACTUAL BOOST YOUR ENERGY???'
  check('the headline MVP actually published is caught', hasHealthClaim(shipped), shipped)
  check('and it is removed rather than reworded', scrubHealthClaims(shipped) === '', scrubHealthClaims(shipped))
  check('the full scrub catches it too', scrubBanned(shipped) === '', scrubBanned(shipped))
}

// ── the supplement vocabulary ───────────────────────────────────────────────
{
  const claims = [
    'Supports testosterone naturally',
    'Boost your energy in 7 days',
    'Improves energy levels and stamina',
    'Does this really increase muscle mass?',
    'Promotes joint health and mobility',
    'Supports digestion and gut health',
    'Helps with brain fog',
    'Enhances muscle recovery after training',
    'Improves sleep quality',
    'Restores hormonal balance',
    'Supports liver function',
    'Increases collagen production',
    'Aids nutrient absorption',
    'Reduces cortisol',
    'Improves heart health',
  ]
  for (const c of claims) check(`caught: "${c}"`, hasHealthClaim(c), c)
}

// ── a question is not an exception ──────────────────────────────────────────
// The thumbnail voice is interrogative by design, which is exactly how a claim
// gets made without appearing to make one.
{
  const questions = [
    'Does this actually boost your energy?',
    'Can beef organs really support testosterone?',
    'Will this improve your sleep quality?',
  ]
  for (const q of questions) check(`a question is still a claim: "${q}"`, hasHealthClaim(q), q)
}

// ── what must survive ───────────────────────────────────────────────────────
// A guard that eats ordinary product copy gets turned off, and then it protects
// nothing at all.
{
  const fine = [
    'Supports 4K at 120Hz',
    'This fridge is energy efficient and cheap to run',
    'Energy Star rated, so the running cost stays low',
    'Cuts my energy bill by a third',
    'Supports fast charging and wireless charging',
    'The stand supports up to 40 pounds',
    'Improves the picture on older TVs',
    'This mount fixes the wobble on a cheap desk',
    'Boosts the wifi signal to the back of the house',
    'Reduces glare on a bright screen',
    'Restores faded plastic trim',
    'Repairs a scratched wooden joint',
    'Increases storage to 2TB',
  ]
  for (const f of fine) {
    check(`survives: "${f}"`, !hasHealthClaim(f), f)
    check(`and is not stripped: "${f}"`, scrubHealthClaims(f) === f, scrubHealthClaims(f))
  }
}

// ── one bad line does not take the whole caption ────────────────────────────
{
  const caption = [
    'Beef organ capsules from a US maker.',
    'Supports testosterone and energy levels.',
    '60 capsules a bag, about a month at the labelled serving.',
  ].join('\n')
  const out = scrubHealthClaims(caption)
  check('the claim line is gone', !/testosterone/i.test(out), out)
  check('the factual lines stay', /US maker/.test(out) && /60 capsules/.test(out), out)
}

// ── the older condition list still works ────────────────────────────────────
// The additions must not have broken what was already caught.
{
  const old = [
    'Do these stop cold sores fast?',
    'Clears up eczema in a week',
    'Gets rid of toenail fungus',
    'Reduces inflammation and swelling',
  ]
  for (const o of old) check(`still caught: "${o}"`, hasHealthClaim(o), o)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
