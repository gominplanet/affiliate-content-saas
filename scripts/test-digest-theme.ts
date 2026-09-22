// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A ROUNDUP MAY NOT NAME A CATEGORY IT DOES NOT CONTAIN.
//
// A post went live at /s-best-toys-games-deals/ with nothing in it that was a
// toy. Two separate faults stacked, and both are the same mistake: trusting a
// claim nothing checked.
//
//   THE PRODUCTS WERE NOT A CATEGORY. pickDigestDeals searches the creator's
//   niches and, when fewer than three match, falls back to the biggest verified
//   discounts across the whole catalogue. That set shares nothing except being
//   real price drops. It returned the same shape either way, so the writer
//   could not tell one from the other and named a category regardless.
//
//   THE MODEL'S ANSWER WAS TAKEN ON TRUST. Nothing asked whether any of the
//   products actually mentioned the theme it had chosen.
//
// And the URL carried a third, smaller one: "This Week's Best Toys" becomes
// "this week s best toys" with the apostrophe stripped, and the orphaned "s"
// was not a stopword, so it led the slug.
import { readFileSync } from 'node:fs'
import { themeIsSupported, keywordSlug } from '../lib/weekly-digest'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIB = live(read('lib/weekly-digest.ts'))
const CRON = live(read('app/api/cron/weekly-deal-digest/route.ts'))

// ── the picker says which kind of set it returned ───────────────────────────
{
  check('a niche match and a best-overall fallback are told apart',
    /matchedNiche: true/.test(LIB) && /matchedNiche: false/.test(LIB),
    'one shape for both is what let a random set be titled as a category')
  check('and the caller carries it through rather than dropping it',
    /const \{ rows, matchedNiche \} = await pickDigestDeals/.test(CRON)
    && /matchedNiche,/.test(CRON),
    'a flag the caller discards is a flag that changes nothing')
  check('the writer is told which kind of set it has',
    /NOT selected by subject/.test(LIB),
    'asking for a category name over a random set invites exactly this')
}

// ── the theme has to be supported by the products ───────────────────────────
{
  const toys = [
    'Anker 737 Power Bank 24000mAh',
    'Ninja Air Fryer Max XL 5.5 Quart',
    'Sony WH-1000XM5 Wireless Headphones',
  ]
  check('a category no product mentions is refused',
    !themeIsSupported('toys games', toys),
    'this is the exact post: a toys title over a power bank, an air fryer and headphones')
  check('and one a product does mention is allowed',
    themeIsSupported('headphones', toys))
  // A CRUDE SINGULAR, so the plural in a theme still matches a singular title.
  check('a plural theme matches a singular product',
    themeIsSupported('air fryers', ['Ninja Air Fryer Max XL']),
    'rejecting "fryers" over a "Fryer" would make the check refuse good themes')
  // SHORT WORDS MATCH EVERYTHING and carry nothing: "pet" is inside "carpet".
  check('short words are not treated as evidence',
    !themeIsSupported('pet', ['Shark Carpet Cleaner']),
    'a substring hit on a three letter word is not a category')
  check('an empty theme is not supported',
    !themeIsSupported('', toys) && !themeIsSupported('   ', toys))

  check('the gate needs BOTH the niche match and the support',
    /const themeEarned = opts\.matchedNiche === true && supported/.test(LIB),
    'either one alone still ships a title about something the post does not contain')
  check('an unearned theme becomes "deals"',
    /themeEarned \? themeClean : 'deals'/.test(LIB),
    'the theme is the URL and the site category, so it has to be honest on its own')
  // THE TITLE FOLLOWS THE THEME, or the URL is fixed and the headline still lies.
  check('and the title falls back with it',
    /themeEarned && modelTitle\.length/.test(LIB),
    'a corrected URL under a headline still claiming toys is the half fix that reads as a whole one')
  check('a rejected theme is logged rather than swallowed',
    /rejected \(matchedNiche/.test(LIB),
    'a silent correction cannot be investigated when it corrects the wrong thing')
}

// ── the slug ────────────────────────────────────────────────────────────────
{
  check('an orphaned possessive never leads the slug',
    keywordSlug("This Week's Best Toys & Games Deals", 'toys games') === 'best-toys-games-deals',
    keywordSlug("This Week's Best Toys & Games Deals", 'toys games'))
  check('and the same for other contractions',
    !/(^|-)(s|t|d|ll|re|ve|m)(-|$)/.test(keywordSlug("Here's What I'd Grab And We've Seen", 'deals')),
    keywordSlug("Here's What I'd Grab And We've Seen", 'deals'))
  check('a real one word title still produces a slug',
    keywordSlug('Kitchen', 'kitchen').length >= 3)
  // THE REQUIREMENT IS THE FRAGMENT, not a particular wording. When the
  // stopword pass leaves too few words it falls back to the unfiltered list,
  // which is deliberate and gives a longer but still readable slug. What must
  // never survive either path is the orphaned possessive.
  {
    const slug = keywordSlug("This Week's Best Deals", 'deals')
    check('the generic theme gives a generic slug',
      /best-deals$/.test(slug) && !/(^|-)s(-|$)/.test(slug), slug)
  }
}

if (failures.length) {
  console.error(`\n❌ digest-theme: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ digest-theme: a roundup only names a category its products actually share, and no orphaned possessive leads the URL')
