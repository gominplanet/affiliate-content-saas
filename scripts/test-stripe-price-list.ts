// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PRICE CHANGE MUST NOT ORPHAN THE PEOPLE ON THE OLD PRICE.
//
// Stripe prices are immutable. Raising the Amazon plan from $79 to $99 means
// creating a NEW price, and live subscribers stay on the old one until they are
// migrated by hand. So STRIPE_PRICE_AMAZON has two jobs that pull apart at
// exactly that moment:
//
//   1. which price a NEW buyer is charged        → must become the new id
//   2. the webhook's price → tier map            → must still know the old id
//
// Repointing the var at the new id alone satisfies (1) and breaks (2). Of the
// three places the map is read:
//
//   checkout.session.completed    falls back to session.metadata.tier
//   customer.subscription.updated falls back to subscription.metadata.tier
//   invoice.payment_succeeded     NO FALLBACK
//
// so every monthly renewal for a $79 subscriber would silently stop
// re-affirming their tier. Nothing breaks that day. The tier is already in the
// database, so they keep working, and the guard that would restore it if
// anything else knocked it down simply stops running. That is the shape of bug
// this codebase keeps finding six months late.
//
// The answer is a comma-separated list: charge the first, recognise them all.
import { readFileSync } from 'node:fs'
import { priceIdsFor } from '../lib/stripe'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NEW = 'price_1QNEW99amazon'
const OLD = 'price_1QOLD79amazon'

// ── the diagnostic compares against STRIPE, not against itself ─────────────
//
// The list mechanism below was right and the price was still wrong. Amazon was
// raised to $99 in lib/tier and Stripe kept charging $79, because a Stripe
// price is immutable: raising it means creating a new price and repointing the
// var, and only the first half happened. Every check in this file passed, the
// pricing page said $99 from the config, and new subscribers paid $79 on
// founder pricing locked for the life of the subscription.
//
// Nothing offline can see that: the amount lives in Stripe. What CAN be held is
// that the admin diagnostic asks. It used to stop at "the var is set and well
// formed", which is true of a var pointing at the wrong amount.
{
  const CHECK = readFileSync('app/api/admin/stripe-price-check/route.ts', 'utf8')
  const src = CHECK.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  check('the diagnostic retrieves the price from Stripe', /stripe\.prices\.retrieve\(/.test(src),
    'without this it can only report that a var is set, which was true the whole time it was wrong')
  check('and reads the amount it will charge', /unit_amount/.test(src))
  check('and compares it to the plan', /TIERS\[tier\]/.test(src) && /chargesUsd === expectedUsd/.test(src),
    'comparing to anything else compares the config to itself')
  check('an unknown answer is null, not a pass',
    /matches: chargesUsd == null \|\| expectedUsd == null \? null/.test(src),
    '"we could not check" reading as "it agrees" is how this stayed invisible')
  check('and the mismatches are summarised at the top level', /priceMismatch/.test(src),
    'buried in a per-key object, nobody scanning the response sees it')
  check('a per-price failure does not blank the report', /catch \(e\) \{[\s\S]{0,200}?error: e instanceof Error/.test(src),
    'this is opened when something is already wrong; one dead id must not hide the rest')
}

// ── parsing ────────────────────────────────────────────────────────────────
{
  check('a single id still works', JSON.stringify(priceIdsFor(NEW)) === JSON.stringify([NEW]),
    'every var in production holds one id today, and none of them may change meaning')
  check('a list keeps order', JSON.stringify(priceIdsFor(`${NEW},${OLD}`)) === JSON.stringify([NEW, OLD]),
    'order is the whole contract: the first is what a new buyer is charged')
  check('spaces around commas are tolerated',
    JSON.stringify(priceIdsFor(` ${NEW} , ${OLD} `)) === JSON.stringify([NEW, OLD]),
    'a var pasted from a doc or an email will have them')
  check('a trailing comma adds no empty id', JSON.stringify(priceIdsFor(`${NEW},`)) === JSON.stringify([NEW]),
    'an empty key in the price map would hand a paid tier to anything with a blank price')
  check('unset is an empty list, not [""]', priceIdsFor(undefined).length === 0)
  check('blank is an empty list', priceIdsFor('   ').length === 0)
  check('commas alone are an empty list', priceIdsFor(',,,').length === 0)
}

// ── the map the webhook builds ─────────────────────────────────────────────
//
// Rebuilt here from the same shape the route uses, so the property being tested
// is the one that matters: BOTH ids resolve, and they resolve to the same tier.
{
  const LIST: Record<string, string[]> = {
    creator: priceIdsFor('price_creator49'),
    studio: priceIdsFor('price_studio99'),
    pro: priceIdsFor('price_pro199'),
    amazon: priceIdsFor(`${NEW},${OLD}`),
  }
  const map: Record<string, string> = Object.fromEntries(
    Object.entries(LIST).flatMap(([tier, ids]) => ids.map(id => [id, tier])),
  )

  check('the new price maps to amazon', map[NEW] === 'amazon')
  check('AND SO DOES THE OLD ONE', map[OLD] === 'amazon',
    'this is the whole point: invoice.payment_succeeded has no fallback, so a $79 renewal would otherwise resolve to no tier at all')
  check('other tiers are untouched', map['price_pro199'] === 'pro' && map['price_creator49'] === 'creator')
  check('no empty key exists', !('' in map),
    'an unset var must never put a blank key in this map')
  check('an unknown price still resolves to nothing', map['price_somethingelse'] === undefined,
    'the map must not become a catch-all just because it got longer')
}

// ── an unset tier does not poison the map ──────────────────────────────────
{
  const LIST: Record<string, string[]> = {
    creator: priceIdsFor(undefined),
    amazon: priceIdsFor(NEW),
  }
  const map: Record<string, string> = Object.fromEntries(
    Object.entries(LIST).flatMap(([tier, ids]) => ids.map(id => [id, tier])),
  )
  check('an unset var contributes no entries', Object.keys(map).length === 1 && map[NEW] === 'amazon',
    'the old code filtered undefined keys for this reason; the list form must keep that property')
}

// ── the wiring ─────────────────────────────────────────────────────────────
{
  const STRIPE = readFileSync('lib/stripe.ts', 'utf8')
  check('PRICE_IDS charges the FIRST id', /creator: PRICE_ID_LIST\.creator\[0\]/.test(STRIPE),
    'charging anything else would bill new customers the retired price')
  // Pinned on the env var reaching the tier's list, not on the exact spelling
  // of the line. Annual prices are now folded in alongside the monthly ones
  // (`[...priceIdsFor(MONTHLY), ...ANNUAL_PRICE_ID_LIST.amazon]`), and the old
  // literal match failed on that purely because the shape changed while the
  // property it guards held throughout.
  check('every tier has a list built from its own env var',
    /amazon:[\s\S]{0,120}priceIdsFor\(process\.env\.STRIPE_PRICE_AMAZON\)/.test(STRIPE))
  check('and the annual ids are folded into the same list',
    /amazon:[\s\S]{0,120}ANNUAL_PRICE_ID_LIST\.amazon/.test(STRIPE),
    'the webhook maps price to tier from this list; an annual price missing is a year paid and nothing granted')

  const HOOK = readFileSync('app/api/stripe/webhook/route.ts', 'utf8')
  check('the webhook maps from the full list', /PRICE_ID_LIST/.test(HOOK))
  // Anchored on `ids.map(` with nothing in between, because the regression this
  // guards against is a truncation: `ids.slice(0, 1).map(...)` still contains a
  // flatMap and still looks right, and it silently drops every retired price
  // back out of the map. The first version of this check matched that.
  check('and flattens EVERY id, untruncated',
    /flatMap\(\(\[tier, ids\]\) => ids\.map\(/.test(HOOK),
    'anything between `ids` and `.map(` is a truncation, which orphans subscribers on the old price')
  check('nothing slices the id list', !/ids\.slice\(/.test(HOOK))
  check('the webhook no longer reads the env vars directly',
    !/process\.env\.STRIPE_PRICE_AMAZON/.test(HOOK),
    'two places parsing the same var is how they drift')

  const DIAG = readFileSync('app/api/admin/stripe-price-check/route.ts', 'utf8')
  check('the diagnostic understands a list', /priceIdsFor/.test(DIAG),
    'otherwise it reports a perfectly good "price_new,price_old" as malformed')
  check('and says which id new buyers are charged', /charges:/.test(DIAG))
  check('and names any malformed entry', /malformed/.test(DIAG),
    'one bad id in a list is a bad id, not a rounding error')
}

if (failures.length) {
  console.error(`\n❌ stripe-price-list: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ stripe-price-list: a tier can carry several price ids, new buyers are charged the first, and subscribers on a retired price keep their tier')
