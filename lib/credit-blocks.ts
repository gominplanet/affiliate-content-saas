// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The one-time "your-voice" dub credit packs: how many credits, what we charge,
// and which env var holds the Stripe price.
//
// WHY IT IS NOT IN lib/stripe.ts, where it used to live. That file constructs
// the Stripe server SDK and reads STRIPE_SECRET_KEY, so nothing rendered in a
// browser can import it. The buttons that sell these packs are in a client
// component, so they typed "$29", "$69" and "$199" by hand, with the real
// amounts written in a comment above the block and nowhere a machine could
// compare them.
//
// That is precisely the arrangement that let /amazon-influencer advertise $79
// against a $99 charge for weeks. A Stripe price is immutable: repricing means
// creating a NEW price and repointing the env var, and no file in the repo
// changes when that happens. So the advertised number lives here, the button
// reads it, and /api/admin/stripe-price-check fetches each id and compares its
// unit_amount against `usd` — which is the only check that can see the gap at
// all, because both sides of it are outside the codebase.

export interface CreditBlock {
  /** Credits added to the ledger when the purchase completes. */
  credits: number
  /** What we advertise, in whole US dollars. Compared against Stripe's
   *  unit_amount by the admin price check. */
  usd: number
  /** The env var holding the Stripe one-time price id. */
  priceEnv: string
}

export const CREDIT_BLOCKS: Record<string, CreditBlock> = {
  '50':  { credits: 50,  usd: 29,  priceEnv: 'STRIPE_PRICE_CREDITS_50' },
  '150': { credits: 150, usd: 69,  priceEnv: 'STRIPE_PRICE_CREDITS_150' },
  '500': { credits: 500, usd: 199, priceEnv: 'STRIPE_PRICE_CREDITS_500' },
}
