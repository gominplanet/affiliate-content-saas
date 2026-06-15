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

interface PBEnvelope {
  status?: { code?: number; msg?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

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
