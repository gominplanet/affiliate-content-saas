// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// COMPARE BRANDS SIDE BY SIDE (Seb, 2026-10-17: "do ... eight", after
// TrybeDaily's compare button on Brands). Two or three brands from Find
// brands, one row per thing that matters, the better value marked. A value
// MVP does not have reads "Not known" and is never the better one, so a brand
// is never ahead for want of a number. Pure, so it is tested
// (scripts/test-trybe-board.ts).

import { bucketDollars } from '@/lib/trybe-pick'

export const COMPARE_MAX = 3

export interface CompareBrand {
  brand_id: string
  name: string
  categories?: string[]
  pay_text?: string | null
  pay_est?: { dollars: number | null; short: string } | null
  total_creators?: number | null
  crowd?: { level: 'open' | 'filling' | 'crowded' | null } | null
  spend?: { dollars: number | null; short: string | null } | null
  earnings_bucket?: string | null
  tiktok_shop?: boolean | null
  top100_hits?: number | null
  meta_ads?: number | null
  meta_ads_checked_at?: string | null
  stats?: { samples: boolean | null; joinedAt: string | null } | null
  review?: { reviewDays: number | null } | null
  pick?: number
  pick_read?: number
  amazon?: { yourVideos: number; storefront: number; ccCampaigns: number; ccBestPct: number | null } | null
}

export interface CompareRow {
  label: string
  says: string
  values: string[]
  /** Which brand has the better value (index), when one does; null for a tie or a row with no better. */
  best: number | null
}

const NK = 'Not known'

/** The index of the single highest (or lowest) known number; null on a tie or nothing known. */
function bestOf(nums: Array<number | null | undefined>, low = false): number | null {
  const known = nums.map((n, i) => ({ n, i })).filter((x): x is { n: number; i: number } => typeof x.n === 'number' && Number.isFinite(x.n))
  if (known.length < 2) return null
  const top = known.reduce((a, b) => ((low ? b.n < a.n : b.n > a.n) ? b : a))
  return known.filter((x) => x.n === top.n).length > 1 ? null : top.i
}

/** The rows, in the order a creator weighs a brand. Pure. */
export function compareRows(brands: CompareBrand[], now = Date.now()): CompareRow[] {
  const b = brands.slice(0, COMPARE_MAX)
  const crowdRank = { open: 0, filling: 1, crowded: 2 } as const
  const days = (x: CompareBrand) => { const t = x.stats?.joinedAt ? Date.parse(x.stats.joinedAt) : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null }
  const yesNo = (v: boolean | null | undefined, yes: string, no: string) => (v === true ? yes : v === false ? no : NK)
  const rows: CompareRow[] = [
    { label: 'Pays', says: 'Its pay terms on TRYBE.', values: b.map((x) => x.pay_text || NK), best: null },
    { label: 'Per approved video', says: 'What a video pays, from your results, members’ results or its fee. For choosing brands only: never put a rate in a message to a brand.',
      values: b.map((x) => x.pay_est?.dollars != null ? x.pay_est.short : x.pay_est?.short || NK), best: bestOf(b.map((x) => x.pay_est?.dollars)) },
    { label: 'Creators', says: 'Fewer creators means more of the budget for you.', values: b.map((x) => (x.total_creators != null ? x.total_creators.toLocaleString('en-US') : NK)), best: bestOf(b.map((x) => x.total_creators), true) },
    { label: 'Room for you', says: 'OPEN, FILLING or CROWDED, from its creators and how fast they join.', values: b.map((x) => (x.crowd?.level ? x.crowd.level.toUpperCase() : NK)), best: bestOf(b.map((x) => (x.crowd?.level ? crowdRank[x.crowd.level] : null)), true) },
    { label: 'Paid out on TRYBE', says: 'What TRYBE shows creators have earned with it, as TRYBE’s own range.', values: b.map((x) => x.earnings_bucket || NK), best: bestOf(b.map((x) => bucketDollars(x.earnings_bucket))) },
    { label: 'Pays creators a month', says: 'MVP’s estimate of what it pays TRYBE creators a month.', values: b.map((x) => (x.spend?.dollars != null && x.spend.short ? x.spend.short : NK)), best: bestOf(b.map((x) => x.spend?.dollars)) },
    { label: 'In TRYBE’s Top 100', says: 'Its videos in TRYBE’s Top 100 now: a sign it spends on ads.', values: b.map((x) => (x.top100_hits != null ? `${x.top100_hits} video${x.top100_hits === 1 ? '' : 's'}` : NK)), best: bestOf(b.map((x) => x.top100_hits)) },
    { label: 'Meta ads running', says: 'Active ads with its name in Meta’s Ad Library, when MVP read them.', values: b.map((x) => (x.meta_ads != null && x.meta_ads_checked_at ? x.meta_ads.toLocaleString('en-US') : NK)), best: bestOf(b.map((x) => (x.meta_ads_checked_at ? x.meta_ads : null))) },
    { label: 'TikTok Shop', says: 'From its own website. Not on TikTok Shop means less competition.', values: b.map((x) => yesNo(x.tiktok_shop, 'On TikTok Shop', 'Not on it')), best: bestOf(b.map((x) => (x.tiktok_shop == null ? null : x.tiktok_shop ? 0 : 1))) },
    { label: 'Samples', says: 'Whether it sends the product to film.', values: b.map((x) => yesNo(x.stats?.samples, 'Sends samples', 'No samples')), best: bestOf(b.map((x) => (x.stats?.samples == null ? null : x.stats.samples ? 1 : 0))) },
    { label: 'Decides videos', says: 'How long it takes to approve or reject, from MVP members’ results.', values: b.map((x) => (x.review?.reviewDays != null ? `${x.review.reviewDays} day${x.review.reviewDays === 1 ? '' : 's'}` : NK)), best: bestOf(b.map((x) => x.review?.reviewDays), true) },
    { label: 'On Amazon', says: 'Your Amazon videos of its products, your storefront, and its Creator Connections.', values: b.map((x) => {
      const a = x.amazon
      if (!a) return NK
      const parts = [a.yourVideos ? `${a.yourVideos} of your videos` : null, !a.yourVideos && a.storefront ? `${a.storefront} in your storefront` : null, a.ccCampaigns ? `Creator Connections${a.ccBestPct ? ` up to ${a.ccBestPct}%` : ''}` : null].filter(Boolean)
      return parts.join(', ') || 'Nothing found'
    }), best: bestOf(b.map((x) => (x.amazon ? x.amazon.yourVideos * 10 + x.amazon.storefront + x.amazon.ccCampaigns : null))) },
    { label: 'Days on TRYBE', says: 'Since it joined TRYBE, when TRYBE says.', values: b.map((x) => { const d = days(x); return d == null ? NK : `${d.toLocaleString('en-US')} day${d === 1 ? '' : 's'}` }), best: null },
    { label: 'Best bet', says: 'MVP’s pick score with Your priorities. Shown once two or more signals are read.', values: b.map((x) => (x.pick != null && (x.pick_read ?? 0) >= 2 ? String(x.pick) : NK)), best: bestOf(b.map((x) => (x.pick != null && (x.pick_read ?? 0) >= 2 ? x.pick : null))) },
    { label: 'Categories', says: 'As TRYBE lists them.', values: b.map((x) => (x.categories?.length ? x.categories.slice(0, 3).join(', ') : NK)), best: null },
  ]
  return rows
}
