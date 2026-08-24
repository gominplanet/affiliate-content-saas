// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared cross-user Keepa cache (migration 288). fetchKeepaBasicsCached() is a
// drop-in for services/keepa fetchKeepaBasics that serves overlapping ASINs from
// one shared table instead of re-paying Keepa per user. Flow per call:
//   1. read keepa_product_cache for the requested ASINs that are still FRESH
//   2. for the rest, hit Keepa once (fetchKeepaBasics)
//   3. write every fetched ASIN back to the cache (data, or an `empty` tombstone
//      so a no-data product isn't re-fetched by the next creator)
//   4. return the merged map — callers then write their own epc_products rows.
//
// The cache uses the service-role (admin) client because it's shared operator
// data, not per-user (RLS-protected) rows.

import { fetchKeepaBasics, type KeepaBasic } from '@/services/keepa'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

const DEFAULT_MAX_AGE_DAYS = (() => {
  const n = Number(process.env.KEEPA_CACHE_MAX_AGE_DAYS)
  return Number.isFinite(n) && n >= 1 ? n : 10
})()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToBasic(r: any): KeepaBasic {
  return {
    asin: String(r.asin).toUpperCase(),
    imageUrl: r.image_url ?? null,
    salesRank: r.sales_rank ?? null,
    salesRankAvg90: r.sales_rank_avg90 ?? null,
    salesRankCategory: r.sales_rank_category ?? null,
    monthlySold: r.monthly_sold ?? null,
    priceNowCents: r.price_now_cents ?? null,
    priceAvg90Cents: r.price_avg_cents ?? null,
    priceLowestCents: r.price_lowest_cents ?? null,
    discountPct: r.discount_pct ?? null,
    dealQuality: r.deal_quality ?? null,
  }
}

function basicToRow(b: KeepaBasic, at: string) {
  return {
    asin: b.asin.toUpperCase(),
    image_url: b.imageUrl ?? null,
    sales_rank: b.salesRank ?? null,
    sales_rank_avg90: b.salesRankAvg90 ?? null,
    sales_rank_category: b.salesRankCategory ?? null,
    monthly_sold: b.monthlySold ?? null,
    price_now_cents: b.priceNowCents ?? null,
    price_avg_cents: b.priceAvg90Cents ?? null,
    price_lowest_cents: b.priceLowestCents ?? null,
    discount_pct: b.discountPct ?? null,
    deal_quality: b.dealQuality ?? null,
    empty: false,
    fetched_at: at,
  }
}

/**
 * Cache-first Keepa basics for many ASINs. Returns a Map keyed by uppercased
 * ASIN (only ASINs that have real data — `empty` tombstones are used to skip a
 * re-fetch but are NOT returned, so callers behave exactly as with fetchKeepaBasics).
 * Never throws: on any cache error it falls back to a direct Keepa fetch.
 */
export async function fetchKeepaBasicsCached(
  admin: Admin,
  asins: string[],
  opts?: { maxAgeDays?: number },
): Promise<Map<string, KeepaBasic>> {
  const valid = [...new Set(asins.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  const out = new Map<string, KeepaBasic>()
  if (!valid.length) return out

  const maxAgeMs = (opts?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 86_400_000
  const freshSince = new Date(Date.now() - maxAgeMs).toISOString()

  // 1. Fresh cache hits (data + tombstones). A tombstone counts as "handled" so
  //    we don't re-fetch a no-data ASIN, but it isn't added to the result map.
  const handled = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (admin as any)
      .from('keepa_product_cache')
      .select('*')
      .in('asin', valid)
      .gte('fetched_at', freshSince)
    for (const r of (rows ?? [])) {
      const a = String(r.asin).toUpperCase()
      handled.add(a)
      if (!r.empty) out.set(a, rowToBasic(r))
    }
  } catch {
    // Cache table missing / read error → fetch everything directly, no caching.
    return await fetchKeepaBasics(valid)
  }

  const missing = valid.filter((a) => !handled.has(a))
  if (!missing.length) return out

  // 2. Fetch the misses from Keepa once.
  const fetched = await fetchKeepaBasics(missing)
  const at = new Date().toISOString()

  // 3. Write every miss back to the cache (data row, or an empty tombstone).
  const rows = missing.map((a) => {
    const b = fetched.get(a)
    return b ? basicToRow(b, at) : { asin: a, empty: true, fetched_at: at }
  })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('keepa_product_cache').upsert(rows, { onConflict: 'asin' })
  } catch { /* caching is best-effort — the data still flows through below */ }

  // 4. Merge the freshly-fetched data into the result.
  for (const [a, b] of fetched) out.set(a, b)
  return out
}
