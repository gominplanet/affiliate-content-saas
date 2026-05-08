import Stripe from 'stripe'

let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-04-30.basil' })
  }
  return _stripe
}

export const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  growth:  process.env.STRIPE_PRICE_GROWTH!,
  pro:     process.env.STRIPE_PRICE_PRO!,
} as const
