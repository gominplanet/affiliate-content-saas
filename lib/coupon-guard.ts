// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH COUPON A CHECKOUT MAY APPLY.
//
// The coupon id comes from the browser (Rewardful's double-sided incentive
// puts it there), so anyone could send any id on the Stripe account. A
// generous one (a staff, test or 100% coupon) would then subscribe for
// nothing. Seb, 2026-10-02: he approves anything generous himself.
//
// So a coupon is applied when it is on Seb's list (STRIPE_APPROVED_COUPONS,
// comma separated ids), or when Stripe says it is mild: valid, at most 30% or
// $20 off, and not "forever". Anything else is not applied, the buyer gets the
// normal promotion-code box, and Seb is told which coupon was tried.

import type Stripe from 'stripe'
import { alertOps } from '@/lib/ops-alert'

export const MILD_PERCENT = 30
export const MILD_AMOUNT_CENTS = 2000

/** Is this coupon mild enough to apply without approval. Pure. */
export function couponIsMild(c: { valid?: boolean | null; percent_off?: number | null; amount_off?: number | null; duration?: string | null }): boolean {
  if (!c.valid) return false
  if (c.duration === 'forever') return false
  if (typeof c.percent_off === 'number') return c.percent_off <= MILD_PERCENT
  if (typeof c.amount_off === 'number') return c.amount_off <= MILD_AMOUNT_CENTS
  return false
}

export function approvedCouponIds(): string[] {
  return String(process.env.STRIPE_APPROVED_COUPONS || '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** The coupon to apply, or null (then the normal promotion-code box shows). */
export async function couponToApply(stripe: Stripe, couponId: string | null | undefined, where: string): Promise<string | null> {
  const id = String(couponId || '').trim()
  if (!id) return null
  if (approvedCouponIds().includes(id)) return id
  try {
    const c = await stripe.coupons.retrieve(id)
    if (couponIsMild(c)) return id
    const what = c.percent_off != null ? `${c.percent_off}% off` : c.amount_off != null ? `${(c.amount_off / 100).toFixed(2)} off` : 'unknown discount'
    await alertOps('A checkout tried a coupon that is not approved', `${where}: coupon ${id} (${what}, ${c.duration}${c.valid ? '' : ', not valid'}). It was not applied. Add it to STRIPE_APPROVED_COUPONS to allow it.`)
  } catch {
    await alertOps('A checkout sent an unknown coupon', `${where}: coupon ${id} could not be read from Stripe. It was not applied.`)
  }
  return null
}
