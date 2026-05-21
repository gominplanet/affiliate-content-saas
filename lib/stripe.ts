import Stripe from 'stripe'

let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-04-30.basil' })
  }
  return _stripe
}

// Two paid plans: Creator $49 / Pro $199. The Creator price is the same
// $49 Stripe price that used to back "Starter" — we keep reading the
// existing STRIPE_PRICE_STARTER env so no Vercel change is required, but
// honour STRIPE_PRICE_CREATOR if you later rename it. The old $99
// "Growth" price is archived and no longer referenced.
export const PRICE_IDS = {
  creator: (process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER)!,
  pro:     process.env.STRIPE_PRICE_PRO!,
} as const
