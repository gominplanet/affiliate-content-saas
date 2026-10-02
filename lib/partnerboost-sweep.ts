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
import { parseCommissionPct, parseDollars, scorePb, isAvoidedPb, PB_RULES, type PbCandidate } from '@/lib/partnerboost-rules'
import { PB_TOKEN_WHERE } from '@/lib/partnerboost-copy'

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
  /** When each brand's products were last saved (brand id or mcid → ms).
   *  Brands refreshed longest ago go first, so a run cut short by the time
   *  limit still moves the whole catalogue forward across runs. */
  lastSynced?: Map<string, number>
}

type SweepBrand = {
  network: PBBrandType; mcid: string | null; brandId: string | null; merchantName: string
  categories: string; trackingUrl: string; commissionPct: number | null; flatPayout: number | null
}

/** Sweep every JOINED brand's products across the networks, in a pool. */
export async function sweepJoinedProducts(
  token: string, opts: SweepOptions = {},
): Promise<{ raw: PbCandidate[]; joinedTotal: number; brandsSwept: number; timedOut: boolean; brandListOk: boolean; brandListError: string | null; productErrors: number; productError: string | null; productDropped: number; productThrottled: number }> {
  const concurrency = opts.concurrency ?? 4
  const deadlineMs = opts.deadlineMs ?? 250_000
  const focus = (opts.focus || '').trim().toLowerCase()

  // 1. Joined brands across the networks (paginated), optionally brand-gated.
  let joinedTotal = 0
  const brands: SweepBrand[] = []
  // WHETHER PARTNERBOOST ANSWERED AT ALL, and if not, what it said. A refused
  // token used to look exactly like a catalogue with nothing in it: 0 brands,
  // 0 products, "ok". The cache then froze for a month with nothing saying so.
  let brandListOk = false
  let brandListError: string | null = null
  for (const network of NETWORKS) {
    for (let page = 1; page <= MAX_BRAND_PAGES; page++) {
      let res
      // The brand list gets the same patience as products: "Too many
      // request" and a dropped connection are waited out and asked again.
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try { res = await listPartnerBoostBrands(token, { brandType: network, relationship: 'Joined', page, limit: BRAND_LIMIT }) }
        catch (e) {
          lastErr = e
          const m = e instanceof Error ? e.message : String(e)
          if (!/too many request|rate|429|ECONNRESET|socket|terminated|fetch failed|timed? ?out/i.test(m)) break
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)))
        }
      }
      if (!res) { if (!brandListError) brandListError = lastErr instanceof Error ? lastErr.message : String(lastErr); break }
      brandListOk = true
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
  // Stalest brands first (never saved counts as stalest), then the best
  // commission, so the budget is spent where the money is.
  const seenAt = (b: SweepBrand) => opts.lastSynced?.get(b.brandId || b.mcid || '') ?? 0
  brands.sort((a, b) => seenAt(a) - seenAt(b) || (b.commissionPct ?? 0) - (a.commissionPct ?? 0) || (b.flatPayout ?? 0) - (a.flatPayout ?? 0))

  // 2. Per-brand product pull in a CONCURRENCY pool.
  const raw: PbCandidate[] = []
  const t0 = Date.now()
  let brandsSwept = 0
  let cursor = 0
  let timedOut = false
  // A brand whose products could not be read is counted and its reason kept,
  // never folded into "this brand has no products".
  let productErrors = 0
  let productError: string | null = null
  // Two kinds of failure, said apart: PartnerBoost answering no ("PartnerBoost:
  // <its message>") and the connection dropping mid-answer ("terminated",
  // "fetch failed", a timeout), which is load and worth one more try.
  let productDropped = 0
  let productThrottled = 0
  // PACING. PartnerBoost publishes no rate limit but answers "Too many
  // request" when asked too fast. Requests start at least MIN_GAP_MS apart
  // across all workers, and a "too many" answer pauses every worker, longer
  // each time, before that brand is tried again.
  const MIN_GAP_MS = 250
  let nextSlot = 0
  let pauseUntil = 0
  let backoff = 0
  const isThrottle = (m: string) => /too many request|rate limit|\b429\b/i.test(m)
  async function waitTurn() {
    for (;;) {
      const now = Date.now()
      const at = Math.max(now, nextSlot, pauseUntil)
      if (at <= now) { nextSlot = now + MIN_GAP_MS; return }
      await new Promise((r) => setTimeout(r, at - now))
    }
  }
  const fetchProducts = (b: SweepBrand) => b.network === 'Amazon'
    ? listAmazonProducts(token, { brandId: b.brandId || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
    : listPartnerBoostProducts(token, { brandType: b.network, brandId: b.brandId || undefined, mcid: b.mcid || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
  async function sweepOne(b: SweepBrand) {
    let products: PBProduct[] = []
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      await waitTurn()
      try { products = (await fetchProducts(b)).products; lastErr = null; backoff = Math.max(0, backoff - 1000); break }
      catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : String(e)
        if (Date.now() - t0 > deadlineMs || attempt === 4) break
        if (isThrottle(msg)) {
          // Everyone waits, longer each time, up to 30 seconds.
          backoff = Math.min(30_000, backoff ? backoff * 2 : 4000)
          pauseUntil = Math.max(pauseUntil, Date.now() + backoff)
          continue
        }
        if (/^PartnerBoost:/.test(msg) || attempt >= 2) break // a real refusal is not retried
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      productErrors++
      if (isThrottle(msg)) productThrottled++
      else if (!/^PartnerBoost:/.test(msg)) productDropped++
      if (!productError) productError = msg
      brandsSwept++
      return
    }
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
        brandId: b.brandId,
        brandMcid: b.mcid,
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

  return { raw, joinedTotal, brandsSwept, timedOut, brandListOk, brandListError, productErrors, productError, productDropped, productThrottled }
}

/**
 * Sweep a user's whole joined catalog and (re)populate pb_finder_cache for them.
 * Shared by the manual sync route and the nightly cron — pass an authed client
 * (self-serve) or the admin client (cron, arbitrary user). Precomputes
 * score/per_sale/avoided so Finder reads stay a simple ordered SELECT.
 */
export async function syncUserCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, userId: string, token: string, opts: { deadlineMs?: number } = {},
): Promise<{ products: number; brandsSwept: number; joinedTotal: number; timedOut: boolean; syncedAt: string; purged: boolean; productErrors: number; productError: string | null; productDropped: number; productThrottled: number }> {
  // When each brand was last saved, so this run starts with the stalest.
  const lastSynced = new Map<string, number>()
  {
    // Read in pages: a request returns 1,000 rows at most, whatever the
    // limit says, so a catalogue of 16,000 products only showed its first
    // 1,000 here and "stalest first" ordered by a fraction of the brands.
    for (let from = 0; from < 60_000; from += 1000) {
      const { data, error } = await sb.from('pb_finder_cache').select('brand_id,brand_mcid,synced_at')
        .eq('user_id', userId).order('id').range(from, from + 999)
      if (error) break
      const rows = (data ?? []) as Array<{ brand_id: string | null; brand_mcid: string | null; synced_at: string }>
      for (const r of rows) {
        const k = r.brand_id || r.brand_mcid
        const t = Date.parse(r.synced_at)
        if (k && Number.isFinite(t) && t > (lastSynced.get(k) ?? 0)) lastSynced.set(k, t)
      }
      if (rows.length < 1000) break
    }
  }
  const { raw, joinedTotal, brandsSwept, timedOut, brandListOk, brandListError, productErrors, productError, productDropped, productThrottled } = await sweepJoinedProducts(token, {
    lastSynced,
    concurrency: 4,
    deadlineMs: opts.deadlineMs ?? 260_000,
    // Cache everything worth keeping — drop only zero-commission brands.
    brandGate: (b) => (b.commissionPct ?? 0) >= 1 || (b.flatPayout ?? 0) >= 1,
  })
  // PARTNERBOOST SAID NO: a failure, in its own words, never a sync of 0.
  if (!brandListOk && brandListError) {
    const refused = /token|publisher does not exist|user not exist/i.test(brandListError)
    throw new Error(refused
      ? `PartnerBoost no longer accepts your API token (${brandListError.replace(/^PartnerBoost:\s*/, '')}). ${PB_TOKEN_WHERE} Then paste it into the Connect PartnerBoost panel. Your saved catalog is kept until then.`
      : `PartnerBoost did not answer the brand list (${brandListError.replace(/^PartnerBoost:\s*/, '')}). Your saved catalog is kept; MVP tries again every half hour.`)
  }
  // Every joined brand's products refused: the token reads the brand list but
  // not the product feeds. Said, never saved as an empty catalogue.
  if (brandsSwept > 0 && productErrors === brandsSwept) {
    throw new Error(`PartnerBoost listed your ${joinedTotal} joined brands but no brand's products could be read (${String(productError || '').replace(/^PartnerBoost:\s*/, '')}). Your saved catalog is kept.`)
  }
  const runStart = new Date().toISOString()
  const bestByKey = new Map<string, ReturnType<typeof scorePb>>()
  for (const c of raw) {
    if (!c.key) continue
    const scored = scorePb(c)
    const prev = bestByKey.get(c.key)
    if (!prev || scored.score > prev.score) bestByKey.set(c.key, scored)
  }
  const rows = Array.from(bestByKey.values()).map((m) => ({
    user_id: userId,
    product_key: String(m.key).slice(0, 1000),
    name: m.name ? String(m.name).slice(0, 400) : null,
    price: m.priceNum,
    commission_pct: m.commissionPct,
    flat_payout: m.flatPayout,
    per_sale: m.perSale,
    score: m.score,
    avoided: isAvoidedPb(m, PB_RULES),
    image_url: m.image ? String(m.image).slice(0, 1000) : null,
    url: m.url ? String(m.url).slice(0, 1000) : null,
    category: m.category ? String(m.category).slice(0, 200) : null,
    brand_name: m.brandName ? String(m.brandName).slice(0, 200) : null,
    brand_id: m.brandId ? String(m.brandId).slice(0, 64) : null,
    brand_mcid: m.brandMcid ? String(m.brandMcid).slice(0, 64) : null,
    network: m.network,
    sku: m.sku ? String(m.sku).slice(0, 120) : null,
    tracking_url: m.trackingUrl ? String(m.trackingUrl).slice(0, 1000) : null,
    brand_tracking_url: m.brandTrackingUrl ? String(m.brandTrackingUrl).slice(0, 1000) : null,
    synced_at: runStart,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('pb_finder_cache').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,product_key' })
    if (error) throw new Error(error.message)
  }
  // Purge products not refreshed this run (brands left / gone stale).
  //
  // Only safe when this run actually saw the catalogue. The sweep swallows
  // everything — a `catch { break }` on the brand list, a `catch { return }`
  // per brand — so a PartnerBoost outage during the half-hourly cron produced
  // brands=[] → rows=[] and this delete then wiped 100% of the user's cached
  // catalogue while the cron reported {ok:true, products:0}. Their Finder went
  // empty, and because the rows were gone they dropped out of the `oldest`
  // selection query and were never retried.
  //
  // A partial run (timedOut) is equally unsafe to purge against: the brands it
  // didn't reach look identical to brands that disappeared. So is a run where
  // any brand's products could not be read: its products were not refreshed,
  // and purging would delete them as if the brand had gone.
  // AND EVERY NETWORK'S BRAND LIST ANSWERED. One network failing (Walmart
  // throttled, say) while the others answered made every one of that
  // network's saved products look gone, and the purge deleted them all.
  const purgeSafe = rows.length > 0 && !timedOut && productErrors === 0 && !brandListError
  if (purgeSafe) {
    await sb.from('pb_finder_cache').delete().eq('user_id', userId).lt('synced_at', runStart)
  } else {
    console.warn('[partnerboost-sweep] skipping stale-purge — incomplete run, keeping existing cache', {
      userId, products: rows.length, brandsSwept, joinedTotal, timedOut,
    })
  }
  return { products: rows.length, brandsSwept, joinedTotal, timedOut, syncedAt: runStart, purged: purgeSafe, productErrors, productError, productDropped, productThrottled }
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
