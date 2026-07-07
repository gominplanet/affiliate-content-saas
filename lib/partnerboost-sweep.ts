// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared PartnerBoost sweep — used by BOTH the live Finder
// (/api/partnerboost/finder) and the background catalog sync
// (/api/partnerboost/sync). PB's product feed is per-brand, so covering a big
// joined set means one call per brand; we run them in a concurrency pool.

import {
  listPartnerBoostBrands, listPartnerBoostProducts, listAmazonProducts,
  type PBBrandType, type PBProduct,
} from '@/services/partnerboost'
import { parseCommissionPct, parseDollars, type PbCandidate } from '@/lib/partnerboost-rules'

const NETWORKS: PBBrandType[] = ['Walmart', 'Amazon', 'DTC']
const MAX_BRAND_PAGES = 6
const BRAND_LIMIT = 500
const PRODUCT_LIMIT = 30

export interface SweepOptions {
  /** Passed to the datafeed as `keywords` to narrow at the source. */
  focus?: string
  concurrency?: number
  deadlineMs?: number
  /** Return false to skip a brand before fetching its products (saves calls). */
  brandGate?: (b: { commissionPct: number | null; flatPayout: number | null }) => boolean
}

type SweepBrand = {
  network: PBBrandType; mcid: string | null; brandId: string | null; merchantName: string
  categories: string; trackingUrl: string; commissionPct: number | null; flatPayout: number | null
}

/** Sweep every JOINED brand's products across the networks, in a pool. */
export async function sweepJoinedProducts(
  token: string, opts: SweepOptions = {},
): Promise<{ raw: PbCandidate[]; joinedTotal: number; brandsSwept: number; timedOut: boolean }> {
  const concurrency = opts.concurrency ?? 12
  const deadlineMs = opts.deadlineMs ?? 250_000
  const focus = (opts.focus || '').trim().toLowerCase()

  // 1. Joined brands across the networks (paginated), optionally brand-gated.
  let joinedTotal = 0
  const brands: SweepBrand[] = []
  for (const network of NETWORKS) {
    for (let page = 1; page <= MAX_BRAND_PAGES; page++) {
      let res
      try { res = await listPartnerBoostBrands(token, { brandType: network, relationship: 'Joined', page, limit: BRAND_LIMIT }) }
      catch { break }
      for (const b of res.brands) {
        joinedTotal++
        const commissionPct = parseCommissionPct(b.commRate)
        const flatPayout = parseDollars(b.avgPayout) ?? parseDollars(b.commRate)
        if (opts.brandGate && !opts.brandGate({ commissionPct, flatPayout })) continue
        brands.push({ network, mcid: b.mcid, brandId: b.brandId, merchantName: b.merchantName, categories: b.categories, trackingUrl: b.trackingUrl, commissionPct, flatPayout })
      }
      if (page >= res.totalPage) break
    }
  }
  // Best-commission brands first so the budget is spent where the money is.
  brands.sort((a, b) => (b.commissionPct ?? 0) - (a.commissionPct ?? 0) || (b.flatPayout ?? 0) - (a.flatPayout ?? 0))

  // 2. Per-brand product pull in a CONCURRENCY pool.
  const raw: PbCandidate[] = []
  const t0 = Date.now()
  let brandsSwept = 0
  let cursor = 0
  let timedOut = false
  async function sweepOne(b: SweepBrand) {
    let products: PBProduct[] = []
    try {
      const r = b.network === 'Amazon'
        ? await listAmazonProducts(token, { brandId: b.brandId || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
        : await listPartnerBoostProducts(token, { brandType: b.network, brandId: b.brandId || undefined, mcid: b.mcid || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
      products = r.products
    } catch { brandsSwept++; return }
    for (const p of products) {
      raw.push({
        key: (p.sku && String(p.sku)) || p.url,
        name: p.name,
        priceNum: parseDollars(p.price),
        price: p.price,
        commissionPct: b.commissionPct,
        flatPayout: b.flatPayout,
        image: p.image,
        url: p.url,
        category: p.category,
        brandName: b.merchantName || p.merchantName || p.brand,
        brandCategories: b.categories,
        network: b.network,
        sku: p.sku,
        trackingUrl: p.trackingUrl || '',
        brandTrackingUrl: b.trackingUrl,
      })
    }
    brandsSwept++
  }
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < brands.length) {
      if (Date.now() - t0 > deadlineMs) { timedOut = true; break }
      await sweepOne(brands[cursor++])
    }
  }))

  return { raw, joinedTotal, brandsSwept, timedOut }
}

/**
 * Take a score-sorted list and return the top `limit`, allowing at most
 * `maxPerBrand` picks from any one brand — so one brand's near-duplicate
 * listings can't crowd out everyone else. `exclude` skips already-seen keys.
 */
export function diversify<T extends { key: string; brandName: string | null; network: string }>(
  sorted: T[], opts: { limit: number; maxPerBrand: number; exclude?: Set<string> },
): T[] {
  const out: T[] = []
  const perBrand = new Map<string, number>()
  for (const m of sorted) {
    if (out.length >= opts.limit) break
    if (opts.exclude?.has(m.key)) continue
    const bk = (m.brandName || m.network || '').toLowerCase()
    const n = perBrand.get(bk) ?? 0
    if (n >= opts.maxPerBrand) continue
    perBrand.set(bk, n + 1)
    out.push(m)
  }
  return out
}
