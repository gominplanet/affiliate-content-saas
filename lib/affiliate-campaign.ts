// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The affiliate program's public terms, in one place.
//
// These mirror the live Rewardful campaign and were confirmed by the operator
// (2026-06-17). Change a number here AND in Rewardful: nothing in this repo
// can read Rewardful, so this file is a promise about an external system and
// the only protection is that every screen quotes the same copy of it.
//
// WHY IT MOVED OUT OF app/affiliates/affiliates-client.tsx. It was declared
// inside that client component, so the in-app ReferralBanner could not read it
// and restated the terms by hand: "Earn 10% every month", "10 Pro referrals =
// $199/mo passive, $2,388/year". Both the rate and the arithmetic were typed,
// and the arithmetic depends on a plan price that has already moved once
// ($79 → $99) without the screens quoting it moving with it.

export const AFFILIATE_CAMPAIGN = {
  /** Recurring commission, as a percentage of every payment the referral makes. */
  commissionPct: 10,
  audienceDiscount: '20% off their first 3 months',
  cookieDays: 60,
  /** Minimum balance, in USD, before a payout is sent. */
  payoutThreshold: 50,
  payoutMethod: 'Stripe',
  /** Commission is held this long before it can be paid out. */
  clearanceDays: 60,
} as const

/** The commission rate as a multiplier. */
export const AFFILIATE_RATE = AFFILIATE_CAMPAIGN.commissionPct / 100

/** What `n` referrals on a plan at `planPriceUsd` pay per month. */
export function affiliateMonthly(n: number, planPriceUsd: number): number {
  return n * planPriceUsd * AFFILIATE_RATE
}
