// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NEVER CHARGE A PRICE THE PAGE DID NOT SHOW.
//
// The price a new buyer sees comes from lib/tier (TIERS[tier].price or
// annualPrice). The price they are charged is whatever Stripe price id sits
// first in STRIPE_PRICE_<TIER>[_ANNUAL]. Those are set in two different
// places, by hand, and a price change moves both (2026-10-05: Amazon $99 to
// $139, Pro $199 to $299). In the gap between one moving and the other, a
// checkout would bill $99 under a $139 button, or $299 under a $199 one.
//
// So before checkout starts, the Stripe price's list amount is compared with
// the price on the page. A mismatch refuses the checkout with a plain message
// and pages ops naming both numbers, which is distinguishable from a working
// checkout and from a broken one. A Stripe lookup that fails does not block the
// sale: it is logged and the checkout goes ahead, as it did before this check.

import type Stripe from 'stripe'
import { TIERS, type Tier } from '@/lib/tier'
import { alertOps } from '@/lib/ops-alert'

export const PRICE_MISMATCH_ERROR =
  'This plan’s price is being updated right now, so checkout is paused for a few minutes. Our team has been alerted. Please try again shortly.'

/** The amount in cents the page shows a new buyer for this tier and interval. Pure. */
export function shownPriceCents(tier: Tier, interval: 'month' | 'year'): number | null {
  const t = TIERS[tier]
  if (!t) return null
  const usd = interval === 'year' ? t.annualPrice : t.price
  return typeof usd === 'number' && usd > 0 ? Math.round(usd * 100) : null
}

/** null when the Stripe price matches the shown price (or could not be read);
 *  otherwise the refusal to return. Pages ops on a mismatch. */
export async function priceMismatch(
  stripe: Stripe, priceId: string, tier: Tier, interval: 'month' | 'year', where: string,
): Promise<{ error: string; status: number } | null> {
  const shown = shownPriceCents(tier, interval)
  if (shown == null) return null
  let charged: number | null = null
  try {
    const p = await stripe.prices.retrieve(priceId)
    charged = p?.unit_amount ?? null
  } catch (e) {
    console.error('[price-guard] could not read', priceId, e instanceof Error ? e.message : e)
    return null
  }
  if (charged == null || charged === shown) return null
  void alertOps(
    `Checkout paused: ${tier} ${interval === 'year' ? 'yearly' : 'monthly'} price does not match the page`,
    `${where}: the page shows $${(shown / 100).toFixed(2)} but the first id in STRIPE_PRICE_${tier.toUpperCase()}${interval === 'year' ? '_ANNUAL' : ''} (${priceId}) charges $${(charged / 100).toFixed(2)}. Put the price that matches the page FIRST in that env var (keep the old ids after it so renewals still map) and redeploy. Until then new buyers of this plan are refused.`,
  )
  return { error: PRICE_MISMATCH_ERROR, status: 503 }
}
