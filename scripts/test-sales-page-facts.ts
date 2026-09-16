// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SALES PAGE QUOTES THE PRODUCT, NOT A MEMORY OF IT.
//
// Every number on the marketing site was typed in by hand, and the product
// moved underneath them. Found live on mvpaffiliate.io:
//
//   the Amazon price      $79 across five places, against a real 99. The page
//                         advertised a price Stripe does not charge.
//   the struck price      $129, against a real regularPrice of 179
//   the saving            "Save $50 for life", against a real 80
//   thumbnails            "200 / month", against 250
//   designs               "100 Reels · 40 FB", against 150 and 120. The same
//                         page said 120 Facebook in another section, so it
//                         contradicted itself.
//   brand deals           "40 / month", against 60
//   publishing            "60 posts / month", against 150
//   face models           "1 model · 6 headshots", against 2 and 12
//   the free trial        "5 full posts" and "No time limit", against a trial
//                         that contains NO posts at all (5 thumbnails, 5
//                         designs, 1 face, 2 headshots) and runs 30 days
//
// Every one of those understated the plan except the trial, which overstated
// it. The pricing page already imported TIERS and hardcoded the numbers
// anyway, which is the whole lesson: a number that CAN be typed will be, and
// it will be right on the day it is typed and wrong by the next release.
//
// So this file does not check the values. It checks that the marketing surfaces
// cannot state a number the product does not agree with.
import { readFileSync } from 'node:fs'
import { TIERS } from '../lib/tier'
import { FREE_TRIAL } from '../lib/free-trial'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const LANDING = readFileSync('app/page.tsx', 'utf8')
const PRICING = readFileSync('app/pricing/page.tsx', 'utf8')
const SPLIT = readFileSync('components/landing/AudienceSplit.tsx', 'utf8')
// Comment lines first, everywhere. Each fix below is explained in a comment
// that quotes the OLD wrong number, so a grep over the raw file would flag the
// explanation as the bug.
const strip = (s: string) => s
  // Whole comment BLOCKS first. A line filter only drops the line a block
  // STARTS on, so lines 2..n of every JSX comment survive, and each of those
  // blocks quotes the old wrong number it exists to explain. This guard
  // flagged its own comments as the bug on the first run.
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const landing = strip(LANDING)
const pricing = strip(PRICING)
const split = strip(SPLIT)

// ── no price is typed in ───────────────────────────────────────────────────
//
// The literal that was wrong in five places. Checked as a bare price token so
// a new hardcoded "$79" anywhere on these three surfaces fails, whatever
// sentence it is wrapped in.
{
  for (const [name, src] of [['landing', landing], ['pricing', pricing], ['audience split', split]] as const) {
    check(`${name} quotes no stale Amazon price`, !/\$79\b/.test(src),
      'the Amazon plan is $99; $79 is the price it was BEFORE the change and is not what Stripe charges')
    check(`${name} quotes no stale regular price`, !/\$129\b/.test(src),
      'the struck-through price is regularPrice, which is 179')
  }
  check('the pricing card reads the price', /\$\{TIERS\.amazon\.price\}/.test(pricing))
  check('and the struck price', /\$\{TIERS\.amazon\.regularPrice\}/.test(pricing))
  check('and COMPUTES the saving', /TIERS\.amazon\.regularPrice - TIERS\.amazon\.price/.test(pricing),
    '"Save $50" was typed next to a real saving of $80; a subtraction cannot be wrong')
  check('the landing page reads it too', /\$\{TIERS\.amazon\.price\}/.test(landing))
  check('and so does the audience split', /TIERS\.amazon\.price/.test(split) && /TIERS\.amazon\.regularPrice/.test(split))
}

// ── no cap is typed in ─────────────────────────────────────────────────────
//
// Each of these was a real number on the live page, lower than the truth. They
// are checked by SOURCE rather than by value: asserting the page says "250"
// would pass again the day the cap moves to 300 and the page does not.
{
  const reads = [
    ['thumbnailsPerMonth', 'thumbnails'],
    ['pinsPerMonth', 'pins'],
    ['igPostsPerMonth', 'Reels'],
    ['facebookPostsPerMonth', 'Facebook designs'],
    ['collabsPerMonth', 'brand deals'],
    ['dealsPerMonth', 'posts published'],
    ['maxFaces', 'face models'],
    ['photoboothPerMonth', 'headshots'],
  ] as const
  for (const [field, what] of reads) {
    check(`the ${what} cap is read, not typed`, new RegExp(`TIERS\\.amazon\\.${field}`).test(pricing),
      `it was hardcoded and wrong; TIERS.amazon.${field} is ${String((TIERS.amazon as Record<string, unknown>)[field])}`)
  }
  // The specific literals that were on the page. A guard on the source alone
  // would not notice one of them being typed back in beside the read.
  for (const stale of ['200 / month', '100 Reels', '40 FB', '40 brand deals', '60 posts / month', '1 model · 6 headshots']) {
    check(`the stale "${stale}" is gone`, !pricing.includes(stale),
      'it understated the plan, which is the expensive direction to be wrong in')
  }
}

// ── the free trial is described as what it is ──────────────────────────────
//
// The one place the page OVERSTATED. FREE_TRIAL contains no posts at all, and
// TIERS.trial.articlesPerMonth is 0, so "5 full posts" was not a smaller
// version of the truth but a different product. "No time limit" contradicted
// trialDays outright.
{
  check('the trial contains no posts', TIERS.trial.articlesPerMonth === 0,
    'if this changes, the copy below can start mentioning posts again')
  check('and it has a clock', FREE_TRIAL.trialDays > 0, `${FREE_TRIAL.trialDays} days`)

  check('the page no longer promises posts', !/\d+ full posts|Five free posts/i.test(landing),
    'the trial gives thumbnails and designs; a post is a different thing and the trial has none')
  check('nor claims there is no time limit', !/no time limit/i.test(landing),
    `the trial runs ${FREE_TRIAL.trialDays} days`)
  check('the trial numbers are read', /FREE_TRIAL\.thumbnails/.test(landing) && /FREE_TRIAL\.socialDesigns/.test(landing))
  check('and so is the length', /FREE_TRIAL\.trialDays/.test(landing))
}

// ── the claims that are NOT numbers ────────────────────────────────────────
{
  // 9 is exactly the length of the Social union. If a platform is added or
  // dropped, the page has to be told rather than quietly becoming wrong.
  const TIER_SRC = readFileSync('lib/tier.ts', 'utf8')
  const socials = (TIER_SRC.match(/export type Social =([^\n]+)/)?.[1].match(/'/g)?.length ?? 0) / 2
  check('the Social union still has 9 platforms', socials === 9, `${socials}`)
  check('so "9 places" is true', /9 places|9 channels|9 outputs/.test(LANDING),
    'if the union changes, this check fails and the copy needs updating with it')

  // The founding-price banner hides itself once the date passes, so it cannot
  // go stale on its own. Worth keeping that property.
  check('the founding deadline self-expires', /end\.getTime\(\) <= Date\.now\(\) \) return null|end\.getTime\(\) <= Date\.now\(\)\) return null/.test(LANDING),
    'a countdown that keeps counting after the date is the most obvious kind of stale')
}

if (failures.length) {
  console.error(`\n❌ sales-page-facts: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sales-page-facts: every price and cap on the marketing pages is read from the product, not typed beside it')
