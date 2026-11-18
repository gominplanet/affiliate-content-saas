// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DAILY 20, FROM A SEARCH YOU CHOOSE (Seb, 2026-11-18: "it's a little
// harder for people to understand where to check that little box that says
// write the messages to 20 new brands every day ... we need to ask MVP to find
// or to message those 20 brands based on a very particular set of filters").
// The box used the saved niche alone. Now the creator saves a search from
// Find brands (keywords, niches, how it pays, every filter, the sort) and each
// day MVP takes the next brands from it they have not messaged, writes each
// one their message, and puts them in Ready to send.
//
// THE SWEET SPOT (the same day: "highlight in a different color brands that
// have less than 500 users and have paid out more than $10,000"): room to
// get noticed, and proof the brand pays creators.
// Pure, so it is tested (scripts/test-trybe-daily.ts).

import { readFilters } from './trybe-finder'
import { cleanTerms, BROWSE_SORTS, PAY_TYPES, type BrowseSort, type PayType } from './trybe-outreach'
import { bucketDollars } from './trybe-pick'
import type { FinderFilters } from './trybe-finder'

export interface DailySearch {
  categories: string[]
  keywords: string[]
  payType: PayType
  filters: FinderFilters
  sort: BrowseSort
  /** When it was saved, so the card can say so. */
  savedAt: string | null
}

/** A saved daily search, read safely; null when there is none. Pure. */
export function readDailySearch(v: unknown): DailySearch | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const payType = (PAY_TYPES as readonly string[]).includes(String(o.payType)) ? o.payType as PayType : 'any'
  const sort = (BROWSE_SORTS as readonly string[]).includes(String(o.sort)) ? o.sort as BrowseSort : 'match'
  return {
    categories: cleanTerms(o.categories), keywords: cleanTerms(o.keywords),
    payType, filters: readFilters(o.filters), sort,
    savedAt: typeof o.savedAt === 'string' && !Number.isNaN(Date.parse(o.savedAt)) ? o.savedAt : null,
  }
}

/** Two searches that would find the same brands. Pure. */
export function sameSearch(a: Omit<DailySearch, 'savedAt'> | null, b: Omit<DailySearch, 'savedAt'> | null): boolean {
  if (!a || !b) return a === b
  const terms = (x: string[]) => x.map((t) => t.toLowerCase()).sort().join('|')
  return terms(a.categories) === terms(b.categories) && terms(a.keywords) === terms(b.keywords) && a.payType === b.payType && a.sort === b.sort
    && JSON.stringify(readFilters(a.filters)) === JSON.stringify(readFilters(b.filters))
}

/** Fewer creators than this, and at least SWEET_MIN_PAID paid to creators. */
export const SWEET_MAX_CREATORS = 500
export const SWEET_MIN_PAID = 10_000

/** What MVP knows about a brand's creators and payouts, from Find brands. */
export interface SweetInput { total_creators?: number | null; earnings_bucket?: string | null; stats?: { paidOut?: number | null } | null }

/** The dollars a brand has paid creators: TRYBE's total when MVP read it,
 *  else the low end of its payout range. Null when neither is known. Pure. */
export function paidOutOf(b: SweetInput): number | null {
  const total = b.stats?.paidOut
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) return total
  return bucketDollars(b.earnings_bucket)
}

/** Under 500 creators and $10K or more paid out. A brand MVP does not know
 *  both of is never called one. Pure. */
export function sweetSpot(b: SweetInput): boolean {
  const c = b.total_creators
  const paid = paidOutOf(b)
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c < SWEET_MAX_CREATORS && paid != null && paid >= SWEET_MIN_PAID
}

/** The chip on a sweet spot brand, with its own numbers. Pure. */
export function sweetWords(b: SweetInput): string {
  const paid = paidOutOf(b) ?? 0
  const k = paid >= 1_000_000 ? `$${Math.round(paid / 100_000) / 10}M` : `$${Math.round(paid / 1000)}K`
  return `${(b.total_creators ?? 0).toLocaleString('en-US')} creators, ${k}+ paid out`
}
