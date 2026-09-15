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

/** Every id, per tier. Order matters: the first is what new buyers are charged. */
export const PRICE_ID_LIST: Record<'creator' | 'studio' | 'pro' | 'amazon', string[]> = {
  creator: priceIdsFor(process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER),
  studio:  priceIdsFor(process.env.STRIPE_PRICE_STUDIO),
  pro:     priceIdsFor(process.env.STRIPE_PRICE_PRO),
  // Amazon Influencer — $99 as of 2026-09-14 (was $79). One of the two plans
  // now sold; creator and studio are frozen legacy tiers kept so existing
  // subscribers keep their allowances and their price.
  amazon:  priceIdsFor(process.env.STRIPE_PRICE_AMAZON),
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
