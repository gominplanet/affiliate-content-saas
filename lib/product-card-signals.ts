// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Formatters for the extra Keepa signals we surface on product cards (parity
// with what Oink shows): sales rank + its named category, product age from the
// first-listed date, and the listed month. Pure + framework-free so every card
// (Deal Radar, AMZ Finder, CC Browse, Storefront, deep-dive) formats them the
// same way.

/** "#67 in Health & Household", or "#1,234" when no category, or null. */
export function formatSalesRank(rank?: number | null, category?: string | null): string | null {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return null
  const n = `#${Math.round(rank).toLocaleString()}`
  const cat = (category || '').trim()
  return cat ? `${n} in ${cat}` : n
}

/** Compact product age from the first-listed date: "new", "3 mo", "2y 4mo". */
export function formatProductAge(listedSince?: string | null): string | null {
  if (!listedSince) return null
  const then = new Date(`${listedSince}T00:00:00Z`).getTime()
  if (isNaN(then)) return null
  const months = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44))
  if (months < 1) return 'new'
  if (months < 12) return `${months} mo`
  const yrs = Math.floor(months / 12)
  const rem = months % 12
  return rem ? `${yrs}y ${rem}mo` : `${yrs} yr`
}

/** The listed month, e.g. "May 2026", or null. */
export function formatListedDate(listedSince?: string | null): string | null {
  if (!listedSince) return null
  const d = new Date(`${listedSince}T00:00:00Z`)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "3 mo · listed May 2026" — age with the month in parens/suffix, or just one. */
export function formatAgeWithDate(listedSince?: string | null): string | null {
  const age = formatProductAge(listedSince)
  const when = formatListedDate(listedSince)
  if (age && when) return `${age} · listed ${when}`
  return age || (when ? `listed ${when}` : null)
}

export interface RankTrend {
  /** 'rising' = climbing the charts (lower rank number), 'slipping' = falling. */
  direction: 'rising' | 'slipping' | 'steady'
  label: string
  /** "#67 vs #120 avg" — current rank against the 90-day average. */
  detail: string
}

/**
 * Momentum from the current sales rank vs its 90-day average. A LOWER Amazon
 * sales-rank number means MORE sales, so when now < avg90 the product is
 * climbing (demand rising). We only call a trend when the move is meaningful
 * (>10%), otherwise it's "steady" — avoids crying "rising!" on rank noise.
 */
export function formatRankTrend(
  rankNow?: number | null,
  rankAvg90?: number | null,
): RankTrend | null {
  const now = Number(rankNow)
  const avg = Number(rankAvg90)
  if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(avg) || avg <= 0) return null
  const pct = (avg - now) / avg // >0 → now is a lower (better) rank → rising
  const detail = `#${Math.round(now).toLocaleString()} vs #${Math.round(avg).toLocaleString()} avg`
  const THRESH = 0.1
  if (pct > THRESH) return { direction: 'rising', label: 'Rank rising', detail }
  if (pct < -THRESH) return { direction: 'slipping', label: 'Rank slipping', detail }
  return { direction: 'steady', label: 'Rank steady', detail }
}
