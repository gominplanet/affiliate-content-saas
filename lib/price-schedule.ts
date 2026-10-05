// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRICE CHANGE OF NOVEMBER 1, AND THE LOCK FOR EVERYONE WHO JOINS BEFORE.
//
// Seb, 2026-10-05: new members pay Amazon $159 and Pro $299 a month ($1,590
// and $2,990 a year) from November 1. Anyone who joins before then keeps $99
// or $199 for as long as they stay subscribed, whatever MVP adds, and on
// whichever of the two plans they move to.
//
// The change happens by date, not by deploy: every price read goes through
// newPricesLive(), so the page, checkout and the countdown all turn over at
// the same moment with nobody pressing anything. NEXT_PUBLIC_NEW_MEMBER_PRICES
// overrides it ('off' postpones, 'on' starts early) for the day Seb changes his
// mind. Pure: no server-only imports, so client components read it too.

/** Midnight at the start of November 1, Pacific time (PDT, UTC-7). The last
 *  US midnight, so nobody in the US loses the old price before their own
 *  November 1 begins. */
export const PRICE_CHANGE_AT = '2026-11-01T07:00:00.000Z'

export type PricedTier = 'amazon' | 'pro'
export type PriceInterval = 'month' | 'year'

/** What members who join before the change pay, for good. */
export const PRICES_BEFORE = { amazon: { month: 99, year: 999 }, pro: { month: 199, year: 1999 } } as const
/** What new members pay from the change on (the Stripe prices Seb created). */
export const NEW_MEMBER_PRICES = { amazon: { month: 159, year: 1590 }, pro: { month: 299, year: 2990 } } as const

export function newPricesLive(now: number = Date.now()): boolean {
  const override = process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES
  if (override === 'on') return true
  if (override === 'off') return false
  return now >= Date.parse(PRICE_CHANGE_AT)
}

/** The price a NEW buyer is shown and charged right now. */
export function livePrice(tier: PricedTier, interval: PriceInterval, now?: number): number {
  return (newPricesLive(now) ? NEW_MEMBER_PRICES : PRICES_BEFORE)[tier][interval]
}

/** Time left before the change, or null once it has happened (or is postponed
 *  indefinitely by the override). */
export function timeUntilPriceChange(now: number = Date.now()): { ms: number; days: number; hours: number; minutes: number; seconds: number } | null {
  if (process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES === 'off' || newPricesLive(now)) return null
  const ms = Date.parse(PRICE_CHANGE_AT) - now
  const s = Math.max(0, Math.floor(ms / 1000))
  return { ms, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}
