import { TIERS } from '@/lib/tier'
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
export const PRICE_ID_LIST: Record<'creator' | 'studio' | 'pro' | 'amazon', string[]> = {
  creator: [...priceIdsFor(process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER), ...ANNUAL_PRICE_ID_LIST.creator],
  studio:  [...priceIdsFor(process.env.STRIPE_PRICE_STUDIO), ...ANNUAL_PRICE_ID_LIST.studio],
  pro:     [...priceIdsFor(process.env.STRIPE_PRICE_PRO), ...ANNUAL_PRICE_ID_LIST.pro],
  // Amazon Influencer — $99 as of 2026-09-14 (was $79). One of the two plans
  // now sold; creator and studio are frozen legacy tiers kept so existing
  // subscribers keep their allowances and their price.
  amazon:  [...priceIdsFor(process.env.STRIPE_PRICE_AMAZON), ...ANNUAL_PRICE_ID_LIST.amazon],
}

/** The annual price a NEW buyer is charged, or null when annual is not
 *  configured for that tier. Null is the honest answer and every caller checks
 *  it: offering a yearly button that cannot check out is worse than not
 *  offering one. */
export function annualPriceIdFor(tier: string): string | null {
  const list = ANNUAL_PRICE_ID_LIST[tier as keyof typeof ANNUAL_PRICE_ID_LIST]
  return list && list.length > 0 ? list[0]! : null
}

/** Is a yearly option sellable for this tier right now? */
export function hasAnnual(tier: string): boolean {
  return annualPriceIdFor(tier) !== null
}

/** The price a NEW buyer is charged. The first id in the list. */
export const PRICE_IDS = {
  creator: PRICE_ID_LIST.creator[0]!,
  studio:  PRICE_ID_LIST.studio[0]!,
  pro:     PRICE_ID_LIST.pro[0]!,
  amazon:  PRICE_ID_LIST.amazon[0]!,
} as const

// One-time "your-voice" dub credit blocks. Each is a Stripe ONE-TIME price
// (mode: payment). Set the STRIPE_PRICE_CREDITS_* envs in Vercel after creating
// the prices in Stripe. `credits` is what we add to the ledger on purchase.
//   50 credits  → $29   150 credits → $69   500 credits → $199
export const CREDIT_BLOCKS: Record<string, { credits: number; priceEnv: string }> = {
  '50':  { credits: 50,  priceEnv: 'STRIPE_PRICE_CREDITS_50' },
  '150': { credits: 150, priceEnv: 'STRIPE_PRICE_CREDITS_150' },
  '500': { credits: 500, priceEnv: 'STRIPE_PRICE_CREDITS_500' },
}
export function creditBlockPriceId(block: string): string | null {
  const cfg = CREDIT_BLOCKS[block]
  return cfg ? (process.env[cfg.priceEnv] || null) : null
}
/** Credits for a Stripe price id, or 0 if it isn't a credit-block price. Used by
 *  the webhook to credit the ledger from the ACTUAL purchased price (never
 *  trusting client metadata for the amount). */
export function creditsForPriceId(priceId: string | null | undefined): number {
  if (!priceId) return 0
  for (const cfg of Object.values(CREDIT_BLOCKS)) {
    if (process.env[cfg.priceEnv] && process.env[cfg.priceEnv] === priceId) return cfg.credits
  }
  return 0
}

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
