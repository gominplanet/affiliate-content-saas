import { TIERS } from '@/lib/tier'
import { newPricesLive } from '@/lib/price-schedule'
import Stripe from 'stripe'

let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-04-22.dahlia' })
  }
  return _stripe
}

// Three paid plans: Creator $49 / Studio $99 / Pro $199.
//   - Creator: same $49 Stripe price that used to back "Starter" — we keep
//     reading STRIPE_PRICE_STARTER as a fallback so no Vercel change is
//     required if you haven't renamed yet, but we honour STRIPE_PRICE_CREATOR
//     first if it's set.
//   - Studio: new $99 price. Set STRIPE_PRICE_STUDIO in Vercel after creating
//     the Stripe price; without it the Studio CTA returns "Invalid tier" so
//     users never reach a broken checkout.
//   - Pro: $199 — unchanged.
//   - Amazon: $99 from 2026-09-14 (was $79) — needs a NEW Stripe price object.
/**
 * Every price id a tier is allowed to be on, newest FIRST.
 *
 * A STRIPE_PRICE_* var may hold a comma-separated list, because a price change
 * leaves live subscribers behind on the old one. Stripe prices are immutable,
 * so raising the Amazon plan from $79 to $99 means creating a NEW price, and
 * repointing the var at it alone would drop the old price out of the webhook's
 * price-to-tier map. Of the three places that map is read, one has no fallback
 * (invoice.payment_succeeded), so every renewal for a legacy subscriber would
 * silently stop re-affirming their tier.
 *
 * So: checkout charges the FIRST id, and the webhook recognises ALL of them.
 *
 *     STRIPE_PRICE_AMAZON=price_new99,price_old79
 */
export function priceIdsFor(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
}

export type BillingInterval = 'month' | 'year'

/**
 * ANNUAL PRICE IDS, per tier. Empty until the env var is set, which is the
 * signal every caller uses to decide whether annual can be offered at all.
 *
 * Kept separate from the monthly list rather than appended to it, because the
 * two are read for different questions and conflating them breaks one of them.
 * PRICE_IDS[tier] is "what does a new buyer pay", and it takes the FIRST id in
 * the list; appending the annual price there would be harmless, but appending
 * it in front would start charging every new buyer a year up front. Separate
 * lists make that mistake impossible rather than merely unlikely.
 */
export const ANNUAL_PRICE_ID_LIST: Record<'creator' | 'studio' | 'pro' | 'amazon', string[]> = {
  creator: priceIdsFor(process.env.STRIPE_PRICE_CREATOR_ANNUAL),
  studio:  priceIdsFor(process.env.STRIPE_PRICE_STUDIO_ANNUAL),
  pro:     priceIdsFor(process.env.STRIPE_PRICE_PRO_ANNUAL),
  amazon:  priceIdsFor(process.env.STRIPE_PRICE_AMAZON_ANNUAL),
}

/** Every id a tier is allowed to be on, monthly AND annual.
 *
 *  THE WEBHOOK READS THIS. An annual price missing from here is a customer who
 *  paid a year up front and was granted nothing, because the price-to-tier map
 *  would not recognise what they bought. That is the worst failure available on
 *  this file, so annual ids are folded in at the source rather than at each of
 *  the three call sites that would each have to remember. */
/**
 * THE PRICES NEW MEMBERS PAY FROM NOVEMBER 1 (lib/price-schedule).
 *
 * Their own env vars, so the ids can be set now and the switch happens by date
 * with no deploy: STRIPE_PRICE_AMAZON_NEW, STRIPE_PRICE_AMAZON_ANNUAL_NEW,
 * STRIPE_PRICE_PRO_NEW, STRIPE_PRICE_PRO_ANNUAL_NEW. The existing vars keep the
 * prices of everyone who joined before, and stay what checkout charges until
 * the change. Empty after the change = that plan cannot be bought, and
 * checkout says so and pages ops, rather than charging the old price under the
 * new one.
 */
export const NEW_PRICE_ID_LIST: Record<'pro' | 'amazon', Record<BillingInterval, string[]>> = {
  pro:    { month: priceIdsFor(process.env.STRIPE_PRICE_PRO_NEW),    year: priceIdsFor(process.env.STRIPE_PRICE_PRO_ANNUAL_NEW) },
  amazon: { month: priceIdsFor(process.env.STRIPE_PRICE_AMAZON_NEW), year: priceIdsFor(process.env.STRIPE_PRICE_AMAZON_ANNUAL_NEW) },
}

export const PRICE_ID_LIST: Record<'creator' | 'studio' | 'pro' | 'amazon', string[]> = {
  creator: [...priceIdsFor(process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER), ...ANNUAL_PRICE_ID_LIST.creator],
  studio:  [...priceIdsFor(process.env.STRIPE_PRICE_STUDIO), ...ANNUAL_PRICE_ID_LIST.studio],
  pro:     [...priceIdsFor(process.env.STRIPE_PRICE_PRO), ...ANNUAL_PRICE_ID_LIST.pro],
  // Amazon Influencer — $99 as of 2026-09-14 (was $79). One of the two plans
  // now sold; creator and studio are frozen legacy tiers kept so existing
  // subscribers keep their allowances and their price.
  amazon:  [...priceIdsFor(process.env.STRIPE_PRICE_AMAZON), ...ANNUAL_PRICE_ID_LIST.amazon],
}
// The new prices are recognised by the webhook from the day they exist.
for (const t of ['pro', 'amazon'] as const) PRICE_ID_LIST[t].push(...NEW_PRICE_ID_LIST[t].month, ...NEW_PRICE_ID_LIST[t].year)

/** The price id a NEW buyer is charged right now, or null when none is set. */
export function newBuyerPriceId(tier: string, interval: BillingInterval): string | null {
  if ((tier === 'pro' || tier === 'amazon') && newPricesLive()) {
    return NEW_PRICE_ID_LIST[tier][interval][0] ?? null
  }
  const list = interval === 'year'
    ? ANNUAL_PRICE_ID_LIST[tier as keyof typeof ANNUAL_PRICE_ID_LIST]
    : priceIdsFor(tier === 'creator' ? (process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER)
      : process.env[`STRIPE_PRICE_${tier.toUpperCase()}`])
  return list?.[0] ?? null
}

/** Is this a price someone joined on before the November 1 change (any plan,
 *  monthly or yearly)? Those members keep that price level for good. */
export function isLockedInPrice(priceId: string | null | undefined): boolean {
  if (!priceId) return false
  for (const t of ['pro', 'amazon'] as const) {
    if (NEW_PRICE_ID_LIST[t].month.includes(priceId) || NEW_PRICE_ID_LIST[t].year.includes(priceId)) return false
  }
  return Object.values(PRICE_ID_LIST).some((ids) => ids.includes(priceId))
}

/**
 * The price a member moving to `tier` is put on. Seb, 2026-10-05: whoever joins
 * before November 1 keeps $99 or $199 "whatever tier they take", so a member
 * still on a pre-change price who switches between Amazon and Pro after the
 * change lands on the OLD price of the new plan, not the new-member one.
 * Everyone else gets what a new buyer pays.
 */
export function planChangePriceId(tier: string, interval: BillingInterval, currentPriceId: string | null | undefined): string | null {
  if (isLockedInPrice(currentPriceId) && (tier === 'pro' || tier === 'amazon')) {
    const old = interval === 'year'
      ? ANNUAL_PRICE_ID_LIST[tier][0]
      : priceIdsFor(process.env[`STRIPE_PRICE_${tier.toUpperCase()}`])[0]
    if (old) return old
  }
  return newBuyerPriceId(tier, interval)
}

/**
 * ONE ANSWER TO "WHICH PRICE DOES THIS PLAN CHANGE GO TO", read by both the
 * upgrade preview and checkout, so the number quoted is the number charged.
 *
 * The member KEEPS THEIR CURRENT INTERVAL unless they explicitly asked for the
 * other one: a yearly member switching plans stays yearly. Checkout used to
 * send every in-place change without an interval to monthly while the preview
 * priced it yearly, so a yearly member was quoted one price and charged
 * another. A yearly change with no yearly price configured falls back to
 * monthly and RETURNS that it did, so the preview can say so instead of
 * quoting a different number in silence.
 */
export function planChangeTarget(
  tier: string,
  requested: unknown,
  current: { id?: string | null; recurring?: { interval?: string | null } | null } | null | undefined,
): { priceId: string | null; interval: BillingInterval; fellBackToMonthly: boolean } {
  const interval: BillingInterval = requested === 'year' || requested === 'month'
    ? requested
    : current?.recurring?.interval === 'year' ? 'year' : 'month'
  const priceId = planChangePriceId(tier, interval, current?.id)
  if (priceId || interval === 'month') return { priceId, interval, fellBackToMonthly: false }
  return { priceId: planChangePriceId(tier, 'month', current?.id), interval: 'month', fellBackToMonthly: true }
}

/** The annual price a NEW buyer is charged, or null when annual is not
 *  configured for that tier. Null is the honest answer and every caller checks
 *  it: offering a yearly button that cannot check out is worse than not
 *  offering one. */
export function annualPriceIdFor(tier: string): string | null {
  return newBuyerPriceId(tier, 'year')
}

/** Is a yearly option sellable for this tier right now? */
export function hasAnnual(tier: string): boolean {
  return annualPriceIdFor(tier) !== null
}

/** The price a NEW buyer is charged. The first id in the list. */
// Getters, so the November 1 change takes effect in a server that was already
// running (lib/price-schedule).
export const PRICE_IDS = {
  get creator(): string { return newBuyerPriceId('creator', 'month') ?? '' },
  get studio(): string { return newBuyerPriceId('studio', 'month') ?? '' },
  get pro(): string { return newBuyerPriceId('pro', 'month') ?? '' },
  get amazon(): string { return newBuyerPriceId('amazon', 'month') ?? '' },
}

// Dub credit packs were removed 2026-10-01 with dubbing (nothing goes to
// other Amazon countries any more). None was ever bought.

// A Stripe price id looks like "price_…". Guard against a mis-pasted env value —
// e.g. a `sk_live_…` secret key or a `prod_…` product id ending up in a
// STRIPE_PRICE_* slot, which would either break checkout or (with the metadata
// fallback) silently grant a tier at the wrong price. Real 2026-07 incident:
// STRIPE_PRICE_PRO held the secret key, so "Pro" was only ever granted via a $49
// Payment Link's metadata. Checkout now refuses to start on an invalid price.
export function isValidPriceId(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^price_[A-Za-z0-9]+$/.test(v.trim())
}

/**
 * Can this tier be BOUGHT yearly right now, and at what price?
 *
 * Both halves have to line up: a yearly amount in lib/tier (what we show) and a
 * Stripe price id in the env (what we can charge). Showing $999 while the env
 * var is unset would put a price on the page that checkout cannot honour, and
 * the customer would be charged $99 a month under a button that said otherwise.
 * So this returns null unless both exist, and every surface asks it rather than
 * reading either half alone.
 */
export function annualOfferFor(tier: string): { priceId: string; annualPrice: number; monthlyPrice: number; savingUsd: number; savingPct: number } | null {
  const priceId = annualPriceIdFor(tier)
  if (!priceId) return null
  // Imported lazily through a local require-free lookup to avoid a cycle:
  // lib/tier does not import lib/stripe, and it must stay that way.
  const t = (TIERS as Record<string, { price?: number; annualPrice?: number | null }>)[tier]
  const annualPrice = t?.annualPrice ?? null
  const monthlyPrice = t?.price ?? 0
  if (annualPrice == null || monthlyPrice <= 0) return null
  // THE SAVING IN DOLLARS, not in months, and the difference matters.
  //
  // Both plans land just UNDER two months: $199 x 12 is $2388 against $1999, a
  // saving of $389, which is 1.95 months. Rounding that to "2 months free"
  // overstates it by three days' worth and is the kind of number a customer can
  // check with a calculator. Rounding it DOWN to "1 month free" understates it
  // by almost half and sells the offer short. The dollar figure is exact, it is
  // the bigger number, and nobody has to trust our arithmetic.
  const yearlyIfMonthly = monthlyPrice * 12
  const savingUsd = yearlyIfMonthly - annualPrice
  const savingPct = Math.round((savingUsd / yearlyIfMonthly) * 100)
  return { priceId, annualPrice, monthlyPrice, savingUsd, savingPct }
}
