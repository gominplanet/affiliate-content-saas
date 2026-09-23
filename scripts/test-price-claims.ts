// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NO SCREEN TYPES A PRICE.
//
// WHAT HAPPENED. /amazon-influencer is the destination of a paid Meta
// campaign. It sold the Amazon plan at "$79/mo, was $129, save $50 for life",
// in four places, beside a button that opens a Stripe checkout. The plan had
// been repriced to $99 (regular $179) in lib/tier long before. So the funnel
// ran: pay for the click → the page promises $79 → the checkout asks for $99.
// That is a chargeback, not a support ticket, and the page said it three more
// times on the way down, including in the final call to action.
//
// WHY THE GUARDS WE ALREADY HAD DID NOT SEE IT, which is the more useful half:
//
//   test-pricing-copy reads exactly three files: the homepage, /pricing and
//   the billing page. /amazon-influencer was never one of them. Its own header
//   comment describes this happening once already, when /pricing was the page
//   nothing looked at. A named list of files is a guard that protects the
//   pages somebody remembered.
//
//   test-no-frozen-tiers walks every file, but matches a PLAN SHAPE: "Studio
//   plan", "Upgrade to Creator", "Creator or Pro". The offending line was
//   `{ name: 'Creator', price: '$49', blurb: … }` — a bare label in one string
//   and a price in another, which is the plainest possible way to sell a plan
//   and matched none of the shapes.
//
// So this file walks everything and looks for the thing itself: a dollar
// amount, written out, that equals a price we charge. The fix for every hit is
// the same one the rest of the codebase already uses, which is to interpolate
// it from lib/tier.
//
// THE THIRD-PARTY PRICES ARE NOT THE TARGET. /pricing compares MVP against a
// stack of other tools, several of which cost $49 or $99. Those are supposed
// to be literals: they are somebody else's prices and nothing in this repo can
// derive them. They are written as bare numbers in a data array and rendered
// through `${price}/mo`, so the `$` is in the JSX and not in the data, and the
// rule below only ever looks at a `$` glued to digits.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TIERS, SELLABLE_TIERS, type Tier } from '../lib/tier'
import { CREDIT_BLOCKS } from '../lib/credit-blocks'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

// ── the amounts nobody may type ────────────────────────────────────────────
//
// Every price and struck-through regular price on every tier, plus the credit
// packs. Built from the source rather than listed, so repricing a plan moves
// what this file bans along with it.
const TIER_KEYS = Object.keys(TIERS) as Tier[]
const BANNED = new Map<number, string>()
for (const t of TIER_KEYS) {
  const p = TIERS[t] as { price?: number; regularPrice?: number; label?: string }
  if (p.price) BANNED.set(p.price, `${p.label ?? t} price`)
  if (p.regularPrice) BANNED.set(p.regularPrice, `${p.label ?? t} regular price`)
}
// The credit packs are NOT in the sweep, and that is deliberate. Two of their
// three amounts collide with prices we do not set: $29 is what a competitor
// charges, quoted by name on /run-your-storefront, and banning it would make
// the guard demand that somebody else's price be read from our own plan file.
// They get their own check further down, against Stripe, which is stronger.
void CREDIT_BLOCKS

check('there are amounts to protect',
  BANNED.size >= 4, `only ${BANNED.size} found — lib/tier probably did not parse`)

// ── files that are allowed to say one ──────────────────────────────────────
//
// Narrow on purpose, and each entry names who decided and why. An exemption
// that is not a sentence is how a page talks its way back onto this list.
const EXEMPT = new Map<string, string>([
  // The competitor stack comparison. These are other companies' prices and
  // cannot be derived from anything; the MVP figure beside them is the one
  // that must be interpolated, and is checked separately below.
  ['app/pricing/page.tsx', 'compares third-party tool prices, which are literals by nature'],
  // These are PROMPTS, not screens. Each one names an example price in an
  // instruction telling the model never to put an exact price in a post,
  // which is the same policy this file enforces one layer up.
  ['services/claude/index.ts', 'prompt text forbidding exact prices, with examples'],
  ['app/api/deals/route.ts', 'prompt text forbidding exact prices, with examples'],
  ['lib/thumbnail-text-templates/picker.ts', 'prompt text showing what a price badge looks like'],
])

const ROOTS = ['app', 'components', 'lib', 'services']
const SKIP = /node_modules|\.next|scripts\//

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (SKIP.test(f)) continue
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

/** Strip comments, keeping line numbers so a failure points somewhere real.
 *  A guard that flags its own explanation has happened repeatedly in this
 *  codebase, and every time it cost more than the bug. */
const decomment = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** decomment, plus whole-line `//` notes. Not a blanket `//` strip: that eats
 *  the `//` in every https:// URL on the line and turns real copy into half a
 *  sentence. */
const live = (src: string) => decomment(src)
  .split('\n').map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l)).join('\n')

{
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (EXEMPT.has(file)) continue
      decomment(read(file)).split('\n').forEach((rawLine, i) => {
        if (/^\s*(\/\/|\*)/.test(rawLine)) return
        const line = rawLine.replace(/\/\/.*$/, ' ')
        // `$` immediately followed by digits, not part of a template
        // expression (`${…}` never matches, because a brace follows the $).
        // (?![\d.]) keeps `$49.99` out of it. That string appears in several
        // prompts that tell the model NEVER to write an exact price, and a
        // guard that fails the build for an instruction not to do the thing
        // it guards against is worse than no guard.
        for (const m of line.matchAll(/\$(\d{2,4})(?![\d.])/g)) {
          const n = Number(m[1])
          const what = BANNED.get(n)
          if (!what) continue
          offenders.push(`${file}:${i + 1} types $${n} (${what}) — ${line.trim().slice(0, 96)}`)
        }
      })
    }
  }
  check('no screen types a price we charge', offenders.length === 0,
    `\n      ${offenders.join('\n      ')}`)
}

// ── and on the pages that sell a plan, NO amount is typed at all ───────────
//
// THE SWEEP ABOVE CANNOT SEE A STALE PRICE, which is the only kind that has
// ever shipped. It bans the amounts we charge TODAY, built from lib/tier, so
// the moment $79 stopped being a price it also stopped being a banned string,
// and typing it back into the hero passes every check above. That is not a
// hypothetical: it is precisely what was live on the ad destination.
//
// So on the handful of pages whose job is to sell a subscription, the rule is
// absolute: no literal dollar amount, whatever the number. Each of them
// already reads every figure from lib/tier, so there is nothing legitimate to
// type, and "no number" is a rule a stale number cannot slip past.
//
// /pricing and /run-your-storefront are NOT on this list: they quote
// competitors by name ($29, $20, a $199 writing tool) and those prices are
// nobody's to interpolate.
{
  const STRICT = [
    'app/amazon-influencer/page.tsx',
    'app/affiliates/affiliates-client.tsx',
    'app/page.tsx',
    'components/dashboard/ReferralBanner.tsx',
  ]
  for (const f of STRICT) {
    const hits: string[] = []
    live(read(f)).split('\n').forEach((l, i) => {
      for (const m of l.replace(/\/\/.*$/, ' ').matchAll(/\$(\d{2,4})(?![\d.])/g)) {
        hits.push(`line ${i + 1}: $${m[1]} in ${l.trim().slice(0, 80)}`)
      }
    })
    check(`${f} types no dollar amount at all`, hits.length === 0,
      `${hits.join(' | ')} — every figure on this page comes from lib/tier, so a typed one is either stale or about to be`)
  }
}

// ── and the pages that sell the plan read it from the plan ─────────────────
//
// The sweep above catches a typed number. This catches the other half: a page
// that sells the Amazon plan and never mentions TIERS at all is a page about
// to grow one.
{
  const SELLING_PAGES = [
    'app/page.tsx',
    'app/pricing/page.tsx',
    'app/amazon-influencer/page.tsx',
    'app/own-your-blog/page.tsx',
    'app/run-your-storefront/page.tsx',
    'app/affiliates/affiliates-client.tsx',
  ]
  for (const f of SELLING_PAGES) {
    const src = read(f)
    check(`${f} reads the plans rather than restating them`,
      /from '@\/lib\/tier'/.test(src),
      'a sales page with no import from lib/tier has its numbers from somewhere else')
  }

  // The struck-through price and the saving are the two that a reader checks
  // against each other, so an invented "was" is the claim that costs most.
  const AMZ = read('app/amazon-influencer/page.tsx')
  check('the ad destination interpolates the price, the was-price and the saving',
    /\$\{AMZ\.price\}/.test(AMZ) && /\$\{AMZ\.regularPrice\}/.test(AMZ) && /\$\{AMZ_SAVING\}/.test(AMZ),
    'this page advertised $79 against a $99 charge, with a $129 "was" that was never a price')
  check('and the saving is computed, not asserted',
    /AMZ_SAVING = AMZ\.regularPrice - AMZ\.price/.test(AMZ),
    'a saving typed beside two interpolated numbers is the one that goes wrong silently')
}

// ── nothing offers a plan that checkout refuses ────────────────────────────
//
// test-no-frozen-tiers matches plan-name SHAPES and walked past
// `{ name: 'Creator', price: '$49' }`, which is a price card. This looks for
// the card instead of the sentence.
{
  const AMZ = read('app/amazon-influencer/page.tsx')
  check('the other-plans grid is built from SELLABLE_TIERS',
    /SELLABLE_TIERS\s*\n?\s*\.filter/.test(decomment(AMZ)),
    'it listed Creator and Studio, both frozen: the click went card → checkout → "that plan is not available"')
  check('and it cannot name one that is not sellable',
    !/name: '(?:Creator|Studio)'/.test(decomment(AMZ)), '')

  // The premise, stated so this section fails loudly rather than quietly
  // passing if the plans are ever unfrozen.
  check('Creator and Studio are still frozen',
    !SELLABLE_TIERS.includes('creator') && !SELLABLE_TIERS.includes('studio'),
    `sellable: ${SELLABLE_TIERS.join(', ')}`)
}

// ── the credit packs have one price, and it is checkable ───────────────────
{
  const STAGE = read('components/launchpad/StorefrontStage.tsx')
  const CHECK = read('app/api/admin/stripe-price-check/route.ts')
  check('the buy buttons read the pack price',
    /CREDIT_BLOCKS\[b\]\.usd/.test(STAGE),
    'three prices typed beside a live Stripe checkout is the $79-against-$99 setup exactly')
  check('and the packs are compared against what Stripe charges',
    /CREDIT_BLOCKS/.test(CHECK) && /cfg\.usd/.test(CHECK),
    'a Stripe price is immutable, so nothing in the repo changes when one is repointed: only fetching it can see the gap')
}

// ── the affiliate estimator quotes a commission we would really pay ────────
//
// It had its own `const TIERS = { Amazon: 99, Pro: 199 }`, shadowing the real
// export under the same name, so the duplicate was invisible. Affiliates are
// the people whose job is to repeat our numbers in public.
{
  const AFF = read('app/affiliates/affiliates-client.tsx')
  check('the estimator does not keep its own price table',
    !/const TIERS = \{\s*Amazon:/.test(AFF),
    'a second price list under the same name as the first')
  check('it builds its plans from SELLABLE_TIERS',
    /SELLABLE_TIERS\.map/.test(decomment(AFF)),
    'so a frozen plan cannot be estimated on')
  check('and the total under the earnings card is the sum of its rows',
    // decommented, or the note explaining the old value fails on the word it
    // is explaining. That has happened four times in this codebase's guards.
    /rowTotal/.test(AFF) && !/\$49\.70/.test(live(AFF)),
    'typed, it was right today and three rows that visibly do not add up tomorrow')
}

if (failures.length) {
  console.error(`\n❌ price-claims: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ price-claims: no screen types a price we charge, and nothing offers a plan checkout would refuse')
