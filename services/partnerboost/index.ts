/**
 * PartnerBoost API helpers (publisher side). Used by the admin-only "Walmart
 * PB" Labs tool. Read-only product/datafeed access + the deep-link builder.
 *
 * The token is passed in by the caller (a server-only env var today, a
 * per-user encrypted credential when this opens past admin) — never hardcoded.
 */

const PB_ENDPOINT = 'https://app.partnerboost.com/api.php'

export interface PBProduct {
  name: string
  price: string | null
  oldPrice: string | null
  currency: string | null
  description: string
  image: string | null
  url: string            // walmart.com/ip/... product page
  category: string | null
  brand: string | null
  merchantName: string | null
  mcid: string | null
  brandId: string | null
  sku: string | null
  trackingUrl: string    // per-product affiliate deep-link (may be empty if brand not joined)
}

/** PartnerBoost networks (the API's `brand_type` values). */
export type PBBrandType = 'Walmart' | 'Amazon' | 'DTC' | 'TikTok' | 'Indirect'

/** A brand/merchant relationship from the Monetization API. */
export interface PBBrand {
  mcid: string | null
  brandId: string | null
  merchantName: string
  commRate: string       // e.g. "5%", "Up to 8%", "$5.00" — parse at the rulebook
  avgPayout: string
  relationship: string   // Joined | Pending | Rejected | No Relationship
  allowSml: boolean      // deep-linking enabled
  categories: string
  tags: string
  logo: string
  trackingUrl: string    // deep-link base
}

/**
 * List the caller's brands for one network via the Monetization API
 * (mod=medium&op=monetization_api). Pass relationship='Joined' to get only the
 * brands you can actually monetize. Cursor-free page/limit pagination.
 */
export async function listPartnerBoostBrands(
  token: string,
  opts: { brandType?: PBBrandType; relationship?: string; page?: number; limit?: number } = {},
): Promise<{ brands: PBBrand[]; total: number; totalPage: number }> {
  const qs = new URLSearchParams({
    mod: 'medium',
    op: 'monetization_api',
    token,
    brand_type: opts.brandType || 'Walmart',
    type: 'json',
    page: String(opts.page ?? 1),
    limit: String(opts.limit ?? 500),
  })
  if (opts.relationship) qs.set('relationship', opts.relationship)

  const json = await pbGet(qs)
  if (json?.status?.code !== 0) {
    throw new Error(json?.status?.msg ? `PartnerBoost: ${json.status.msg}` : 'PartnerBoost monetization error')
  }
  const data = json?.data || {}
  const list = Array.isArray(data.list) ? data.list : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brands: PBBrand[] = list.map((b: any) => ({
    mcid: b.mcid ?? null,
    brandId: b.brand_id != null ? String(b.brand_id) : null,
    merchantName: b.merchant_name ?? '',
    commRate: b.comm_rate ?? '',
    avgPayout: b.avg_payout ?? '',
    relationship: b.relationship ?? '',
    allowSml: String(b.allow_sml ?? '') === '1',
    categories: b.categories ?? '',
    tags: b.tags ?? '',
    logo: b.logo ?? '',
    trackingUrl: b.tracking_url ?? '',
  }))
  return {
    brands,
    total: Number(data.total_mcid ?? brands.length) || brands.length,
    totalPage: Number(data.total_page ?? 1) || 1,
  }
}

interface PBEnvelope {
  status?: { code?: number; msg?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

// Coerce API values to safe primitives — a live key can arrive as a nested
// object/array (shape drift), and `??` only guards null/undefined, not objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asStr = (v: any): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asStrOrNull = (v: any): string | null => { const s = asStr(v); return s || null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNum = (v: any): number | null =>
  typeof v === 'number' && isFinite(v) ? v
    : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v)
    : null

async function pbGet(qs: URLSearchParams, timeoutMs = 30_000): Promise<PBEnvelope> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${PB_ENDPOINT}?${qs.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const text = await res.text()
    try {
      return JSON.parse(text) as PBEnvelope
    } catch {
      throw new Error('PartnerBoost returned a non-JSON response (token or endpoint issue).')
    }
  } finally {
    clearTimeout(timer)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProduct(p: any): PBProduct {
  return {
    name: p.name ?? p.title ?? '',
    price: p.price != null ? String(p.price) : null,
    oldPrice: p.old_price != null ? String(p.old_price) : null,
    currency: p.currency ?? null,
    description: p.description ?? '',
    image: p.image ?? null,
    url: p.url ?? '',
    category: p.category ?? null,
    brand: p.brand ?? null,
    merchantName: p.merchant_name ?? null,
    mcid: p.mcid ?? null,
    brandId: p.brand_id != null ? String(p.brand_id) : null,
    sku: p.sku != null ? String(p.sku) : null,
    trackingUrl: p.tracking_url ?? '',
  }
}

/**
 * Pull Walmart products from the PartnerBoost datafeed (mod=datafeed&op=list).
 * Filter to a single brand via brandId (and/or mcid). Reliable product data
 * (name/price/image/description/url + per-product tracking_url) — no scraping.
 */
export async function listPartnerBoostProducts(
  token: string,
  opts: { brandType?: PBBrandType; brandId?: string; mcid?: string; keywords?: string; page?: number; limit?: number } = {},
): Promise<{ products: PBProduct[]; total: number; totalPage: number }> {
  const qs = new URLSearchParams({
    mod: 'datafeed',
    op: 'list',
    token,
    brand_type: opts.brandType || 'Walmart',
    type: 'json',
    page: String(opts.page ?? 1),
    limit: String(opts.limit ?? 40),
  })
  if (opts.brandId) qs.set('brand_id', opts.brandId)
  if (opts.mcid) qs.set('mcid', opts.mcid)
  if (opts.keywords) qs.set('keywords', opts.keywords)

  const json = await pbGet(qs)
  if (json?.status?.code !== 0) {
    throw new Error(json?.status?.msg ? `PartnerBoost: ${json.status.msg}` : 'PartnerBoost datafeed error')
  }
  const data = json?.data || {}
  const list = Array.isArray(data.list) ? data.list : []
  let products: PBProduct[] = list.map(normalizeProduct)
  // Defensive: if the API ignores the brand filter, narrow by mcid ourselves so
  // a brand's "Browse products" never bleeds in other merchants' items.
  if (opts.mcid) products = products.filter((p) => !p.mcid || p.mcid === opts.mcid)
  return {
    products,
    total: Number(data.total_mcid ?? products.length) || products.length,
    totalPage: Number(data.total_page ?? 1) || 1,
  }
}

/** FBA prices come back with a leading "$" ("$61.99"); strip it so downstream
 *  formatting doesn't double up. Returns null for empty. */
function stripMoney(v: unknown): string | null {
  if (v == null || v === '') return null
  return String(v).replace(/^\s*\$/, '').trim() || null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeFbaProduct(p: any): PBProduct {
  const disc = stripMoney(p.discount_price)
  const orig = stripMoney(p.original_price)
  return {
    name: p.product_name ?? '',
    price: disc ?? orig,
    oldPrice: disc && orig && disc !== orig ? orig : null,
    currency: p.currency ?? null,
    description: '',                       // FBA datafeed has no description field
    image: p.image ?? null,
    url: p.url ?? (p.asin ? `https://www.amazon.com/dp/${p.asin}` : ''),
    category: p.category ?? null,
    brand: p.brand_name ?? null,
    merchantName: p.brand_name ?? null,
    mcid: null,
    brandId: p.brand_id != null ? String(p.brand_id) : null,
    sku: p.asin != null ? String(p.asin) : null,
    trackingUrl: p.partnerboost_link || p.link || '',  // ready affiliate link (joined brands)
  }
}

/**
 * Amazon products live behind a DIFFERENT op on the same api.php —
 * `op=get_fba_products` (the generic `op=list` datafeed rejects
 * brand_type=Amazon with "brand_type is invalid"). Envelope is
 * { status, data: { has_more, list } } — no total count, just has_more.
 * Filter to one brand via brand_id (verified server-side too).
 */
export async function listAmazonProducts(
  token: string,
  opts: { brandId?: string; keywords?: string; page?: number; limit?: number } = {},
): Promise<{ products: PBProduct[]; total: number; totalPage: number }> {
  const qs = new URLSearchParams({
    mod: 'datafeed',
    op: 'get_fba_products',
    token,
    type: 'json',
    page: String(opts.page ?? 1),
    page_size: String(opts.limit ?? 40),
  })
  if (opts.brandId) qs.set('brand_id', opts.brandId)
  if (opts.keywords) qs.set('keywords', opts.keywords)

  const json = await pbGet(qs)
  if (json?.status?.code !== 0) {
    throw new Error(json?.status?.msg ? `PartnerBoost: ${json.status.msg}` : 'PartnerBoost FBA datafeed error')
  }
  const data = json?.data || {}
  const list = Array.isArray(data.list) ? data.list : []
  let products: PBProduct[] = list.map(normalizeFbaProduct)
  if (opts.brandId) products = products.filter((p) => !p.brandId || p.brandId === opts.brandId)
  return { products, total: products.length, totalPage: data.has_more ? (opts.page ?? 1) + 1 : (opts.page ?? 1) }
}

/**
 * Build a per-product affiliate deep-link from a brand's monetization tracking
 * base. PartnerBoost tracking links are `…/track/<ID>?url=<encoded dest>`; we
 * just point `url=` at the specific product page (only valid when the brand has
 * deep-linking / allow_sml enabled). Prefer a product's own datafeed
 * tracking_url when present — this is the fallback.
 */
export function buildPartnerBoostDeepLink(brandTrackingBase: string, productUrl: string): string {
  if (!brandTrackingBase) return productUrl
  try {
    const u = new URL(brandTrackingBase)
    u.searchParams.set('url', productUrl)
    return u.toString()
  } catch {
    const sep = brandTrackingBase.includes('?') ? '&' : '?'
    return `${brandTrackingBase}${sep}url=${encodeURIComponent(productUrl)}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Walmart datafeed — the newer REST endpoints (POST JSON, token in the body),
// NOT the legacy api.php?mod=&op= gateway above. These power the "Walmart Deals"
// feed: the Affiliate Boost promotions list gives item_id + a boosted commission
// + a validity window (no product detail), so we enrich each item via the REST
// get_products lookup (name/image/price/url) and mint a commissionable link via
// get_products_link. Field reads are defensive on purpose — the live shapes can
// drift from the docs, same as the Monetization/datafeed calls above.
// Docs: https://docs.partnerboost.com/developers/publisher-api/walmart/
// ─────────────────────────────────────────────────────────────────────────────

const PB_REST_BASE = 'https://app.partnerboost.com/api'

/** POST a JSON body to a REST datafeed endpoint. Same envelope { status, data }. */
async function pbPost(path: string, token: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<PBEnvelope> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${PB_REST_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, ...body }),
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const text = await res.text()
    try {
      return JSON.parse(text) as PBEnvelope
    } catch {
      throw new Error('PartnerBoost returned a non-JSON response (token or endpoint issue).')
    }
  } finally {
    clearTimeout(timer)
  }
}

/** One Walmart offer from the full catalog (get_products), with the signal the
 *  card shows: per-product commission, rating, and discount. */
export interface PBWalmartOffer extends PBProduct {
  itemId: string
  commissionPct: number | null
  rating: number | null
  ratingsTotal: number | null
  discountPct: number | null
}

/**
 * Mint commissionable Walmart tracking links by item id (≤50 per call).
 * POST /walmart_datafeed/get_products_link { item_id: "a,b,c" }. This is the
 * ONLY thing that earns — a bare walmart.com/ip URL carries no attribution.
 * The link routes PartnerBoost → goto.walmart.com (Impact) → Walmart with the
 * publisher's id + sharedid. Returns a map item_id → tracking url (prefers the
 * short pboost.me link). Best-effort: empty map when none can be minted (e.g.
 * the account isn't approved for that Walmart brand).
 */
export async function getWalmartProductLinks(
  token: string,
  itemIds: string[],
): Promise<Record<string, string>> {
  const ids = itemIds.filter(Boolean).slice(0, 50)
  if (ids.length === 0) return {}
  const json = await pbPost('/walmart_datafeed/get_products_link', token, { item_id: ids.join(',') })
  if (json?.status?.code !== 0) return {}
  const data = json?.data || {}
  const out: Record<string, string> = {}
  const pick = (r: Record<string, unknown>): string =>
    asStr(r?.short_link ?? r?.tracking_url ?? r?.smart_link ?? r?.link ?? r?.url ?? r?.attribution_link)
  const list = Array.isArray(data.list) ? data.list : Array.isArray(data) ? data : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of list as any[]) {
    const id = asStr(row?.item_id ?? row?.itemId ?? row?.id)
    const url = pick(row)
    if (id && url) out[id] = url
  }
  // Some payloads return a plain object map { "<item_id>": "<url|obj>" }.
  if (Object.keys(out).length === 0 && data && typeof data === 'object' && !Array.isArray(data.list)) {
    for (const [k, v] of Object.entries(data)) {
      if (k === 'has_more') continue
      if (typeof v === 'string' && v) out[k] = v
      else if (v && typeof v === 'object') { const s = pick(v as Record<string, unknown>); if (s) out[k] = s }
    }
  }
  return out
}

/** commission arrives as a fraction ("0.15"=15) or a percent ("15"/"15%"). */
function pctFrom(v: unknown): number | null {
  const n = asNum(typeof v === 'string' ? v.replace('%', '') : v)
  if (n == null) return null
  return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10
}

/**
 * Browse the FULL Walmart offers catalog (not just joined brands) via the REST
 * datafeed. POST /walmart_datafeed/get_products { page, page_size, relationship?,
 * brand_id?, keyword? }. `relationship` selects the join scope (per the docs:
 * 0/1/2); omit for the broadest set. Returns per-product commission so MVP's
 * rulebook can gate/rank them app-side.
 */
export async function getWalmartOffers(
  token: string,
  opts: { page?: number; pageSize?: number; relationship?: number; brandId?: string; keyword?: string } = {},
): Promise<{ offers: PBWalmartOffer[]; hasMore: boolean; total: number | null }> {
  const body: Record<string, unknown> = {
    page: opts.page ?? 1,
    page_size: Math.min(Math.max(opts.pageSize ?? 50, 1), 50),
  }
  if (opts.relationship != null) body.relationship = opts.relationship
  if (opts.brandId) body.brand_id = opts.brandId
  // Best-effort keyword passthrough — the endpoint documents only brand/item/
  // relationship filters, so callers should also filter app-side.
  if (opts.keyword) { body.keyword = opts.keyword; body.keywords = opts.keyword }

  const json = await pbPost('/walmart_datafeed/get_products', token, body)
  if (json?.status?.code !== 0) {
    throw new Error(json?.status?.msg ? `PartnerBoost: ${json.status.msg}` : 'PartnerBoost get_products error')
  }
  const data = json?.data || {}
  const list = Array.isArray(data.list) ? data.list : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offers: PBWalmartOffer[] = list.map((p: any): PBWalmartOffer => {
    const price = p.sale_price ?? p.price ?? p.min_price
    const old = p.list_price ?? p.old_price ?? p.original_price
    const itemId = asStr(p.item_id ?? p.itemId ?? p.sku)
    return {
      name: asStr(p.name ?? p.title ?? p.product_name),
      price: price != null ? String(price) : null,
      oldPrice: old != null && String(old) !== String(price) ? String(old) : null,
      currency: asStrOrNull(p.currency),
      description: asStr(p.description ?? p.short_description),
      image: asStrOrNull(p.image ?? p.image_url ?? p.main_image ?? p.thumbnail),
      url: asStr(p.url ?? p.product_url ?? p.link ?? (itemId ? `https://www.walmart.com/ip/${itemId}` : '')),
      category: asStrOrNull(p.category ?? p.category_name ?? p.product_category),
      brand: asStrOrNull(p.brand ?? p.brand_name),
      merchantName: asStrOrNull(p.merchant_name ?? p.brand_name),
      mcid: asStrOrNull(p.mcid),
      brandId: p.brand_id != null ? String(p.brand_id) : null,
      sku: asStrOrNull(p.sku ?? p.item_id),
      // Only accept a REAL tracking field here — never p.link/p.url, which are
      // the bare (un-attributed) product page. A commissionable link is minted
      // below via get_products_link.
      trackingUrl: asStr(p.tracking_url ?? p.partnerboost_link ?? ''),
      itemId,
      commissionPct: pctFrom(p.commission ?? p.commission_rate ?? p.comm_rate),
      rating: asNum(p.rating ?? p.avg_rating ?? p.average_rating),
      ratingsTotal: asNum(p.ratings_total ?? p.review_count ?? p.reviews ?? p.rating_count),
      discountPct: asNum(typeof p.discount === 'string' ? p.discount.replace(/[^\d.]/g, '') : (p.discount ?? p.discount_pct)),
    }
  }).filter((o: PBWalmartOffer) => !!o.name && !!o.url)

  // Mint the real commissionable link per item (attribution lives here, not in
  // the datafeed). Best-effort — on failure the card falls back to the bare
  // product URL, which the generate route flags as un-monetized.
  try {
    const need = offers.filter((o) => !o.trackingUrl && o.itemId).map((o) => o.itemId)
    if (need.length) {
      const links = await getWalmartProductLinks(token, need)
      for (const o of offers) { const minted = links[o.itemId]; if (minted) o.trackingUrl = minted }
    }
  } catch { /* keep bare URLs — better a working product link than a broken feed */ }

  return { offers, hasMore: !!(data.has_more ?? data.hasMore), total: asNum(data.total ?? data.total_count) }
}
