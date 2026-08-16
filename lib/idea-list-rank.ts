// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared idea-list ranking: enrich every product (price, rating, reviews,
// demand, deal) and check it against the creator's Creator Connections
// campaigns + their own SCOUT earnings, then score. CC-campaign products always
// rank first (they pay a bounty), then by the MVP score. Used by BOTH the
// generate route (auto pick) and the rank route (manual checklist preview), so
// the ranking a creator SEES matches the one MVP would pick.

import { fetchKeepaProductCard } from '@/services/keepa'

export interface RankInItem { asin: string; title?: string | null; image?: string | null }
export interface RankedProduct {
  asin: string; title: string; image: string | null
  priceCents: number | null; rating: number | null; reviews: number | null
  discountPct: number | null; monthlySold: number | null
  earnings: number; hasCampaign: boolean; score: number
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  })
  await Promise.all(workers)
  return out
}

/**
 * Enrich + score the products of an idea list, CC-campaign products first.
 * `sb` is a Supabase client already scoped for the user. Returns the ranked
 * products (best first) and a by-ASIN lookup.
 */
export async function enrichAndRankIdeaList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  inItems: RankInItem[],
  opts?: { cap?: number; priorityAsins?: string[] },
): Promise<{ ranked: RankedProduct[]; byAsin: Map<string, RankedProduct> }> {
  const cap = Math.max(3, opts?.cap ?? 150)
  const priority = new Set((opts?.priorityAsins || []).map(a => String(a || '').trim().toUpperCase()))
  const allAsins = Array.from(new Set(
    inItems.map(i => String(i.asin || '').trim().toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a)),
  )).slice(0, 500)
  const titleByAsin = new Map(inItems.map(i => [String(i.asin).toUpperCase(), (i.title || '').trim()]))
  const imageByAsin = new Map(inItems.map(i => [String(i.asin).toUpperCase(), i.image || null]))

  // Earnings + campaigns across the WHOLE list, so a campaign product deep in
  // the list is never missed.
  const [{ data: earnRows }, { data: campRows }] = await Promise.all([
    sb.from('storefront_earnings').select('asin,commission').eq('user_id', userId).in('asin', allAsins),
    sb.from('campaigns').select('asin').eq('user_id', userId).in('asin', allAsins),
  ])
  const earnByAsin = new Map<string, number>()
  for (const r of (earnRows || []) as Array<{ asin: string; commission: number | null }>) {
    earnByAsin.set(r.asin, (earnByAsin.get(r.asin) || 0) + (Number(r.commission) || 0))
  }
  const campaignAsins = new Set((campRows || []).map((r: { asin: string }) => r.asin))

  // Candidate set: campaign products AND any explicitly-requested (e.g. manually
  // selected) products first — never dropped by the cap — then the rest in list
  // order, up to the cap.
  const first = allAsins.filter(a => campaignAsins.has(a) || priority.has(a))
  const rest = allAsins.filter(a => !campaignAsins.has(a) && !priority.has(a))
  const asins = [...first, ...rest].slice(0, Math.max(cap, first.length))

  const cards = await pool(asins, 6, async (asin) => {
    let k = null
    try { k = await fetchKeepaProductCard(asin) } catch { /* degrade gracefully */ }
    return { asin, k }
  })
  const enriched: RankedProduct[] = cards.map(({ asin, k }) => ({
    asin,
    title: titleByAsin.get(asin) || `Amazon product ${asin}`,
    image: imageByAsin.get(asin) || (k?.imageUrl ?? null),
    priceCents: k?.priceNowCents ?? null,
    rating: k?.rating ?? null,
    reviews: k?.reviewCount ?? null,
    discountPct: k?.discountPct ?? null,
    monthlySold: k?.monthlySold ?? null,
    earnings: earnByAsin.get(asin) || 0,
    hasCampaign: campaignAsins.has(asin),
    score: 0,
  }))

  const max = (f: (e: RankedProduct) => number) => Math.max(1, ...enriched.map(f))
  const mSold = max(e => e.monthlySold || 0), mEarn = max(e => e.earnings), mRev = max(e => Math.log10((e.reviews || 0) + 1))
  for (const e of enriched) {
    const demand = (e.monthlySold || 0) / mSold
    const earn = e.earnings / mEarn
    const deal = Math.min(1, (e.discountPct || 0) / 40)
    const trust = ((e.rating || 0) / 5) * (Math.log10((e.reviews || 0) + 1) / mRev)
    e.score = earn * 0.34 + demand * 0.26 + trust * 0.20 + deal * 0.12 + (e.hasCampaign ? 0.08 : 0)
  }
  const ranked = enriched.sort((a, b) => {
    if (a.hasCampaign !== b.hasCampaign) return a.hasCampaign ? -1 : 1
    return b.score - a.score
  })
  return { ranked, byAsin: new Map(ranked.map(e => [e.asin, e])) }
}
