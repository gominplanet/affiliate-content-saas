// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Wayward Publisher (Creator) API v3 helpers. Powers the "MVP x Wayward" Labs
 * tool — browse the Amazon Attribution product catalog and mint a real
 * attributed Amazon link per ASIN (measured + commissionable back to the
 * creator's Wayward account).
 *
 * Token is passed in by the caller (per-user encrypted key, or the operator's
 * WAYWARD_API_TOKEN env for admin) — never hardcoded.
 * Base: https://api.wayward.com/creator/v3 — `X-Api-Key` auth, page_number
 * pagination. Rate limits: catalog 240/min, link generation 60/min.
 */

const WAYWARD_BASE = 'https://api.wayward.com/creator/v3'

// Coerce API values to safe primitives so a nested object can never reach a
// React text child (blank-page crash). `??` only guards null/undefined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asStr = (v: any): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asStrOrNull = (v: any): string | null => { const s = asStr(v); return s || null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNum = (v: any): number | null =>
  typeof v === 'number' && isFinite(v) ? v
    : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v)
    : null

export interface WaywardProduct {
  productId: string
  asin: string
  name: string
  brandId: string | null
  brandName: string | null
  price: number | null
  currency: string | null
  commissionRate: number | null // % offered to the creator
  imageUrl: string | null
  marketplace: string | null
  isActive: boolean
}

export interface WaywardProductsPage {
  products: WaywardProduct[]
  pageNumber: number
  pageSize: number
  totalPages: number
  totalProducts: number
}

export interface WaywardBrand {
  id: string
  name: string
  avgCommission: number | null
  activeProductsCount: number | null
}

async function waywardFetch(path: string, token: string, init?: RequestInit, timeoutMs = 30_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${WAYWARD_BASE}${path}`, {
      ...init,
      headers: { 'X-Api-Key': token, 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: ctrl.signal,
    })
    const text = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || `Wayward API ${res.status}`
      throw new Error(res.status === 401 ? 'Wayward rejected the API key (401). Reconnect it in Integrations.'
        : res.status === 429 ? 'Wayward rate limit hit — try again in a minute.'
        : String(msg))
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProduct(p: any): WaywardProduct {
  return {
    productId: asStr(p?.productId),
    asin: asStr(p?.asin),
    name: asStr(p?.name),
    brandId: asStrOrNull(p?.brandId),
    brandName: asStrOrNull(p?.brandName),
    price: asNum(p?.price),
    currency: asStrOrNull(p?.currency),
    commissionRate: asNum(p?.commissionRate),
    imageUrl: asStrOrNull(p?.imageUrl),
    marketplace: asStrOrNull(p?.marketplace),
    isActive: p?.isActive !== false,
  }
}

/**
 * List Attribution products the creator can promote. `asin` filters to one
 * product. The catalog is large (300k+), so callers paginate.
 */
export async function getWaywardProducts(
  token: string,
  opts: { pageNumber?: number; pageSize?: number; asin?: string; brandId?: string } = {},
): Promise<WaywardProductsPage> {
  const params = new URLSearchParams()
  params.set('page_number', String(Math.max(1, opts.pageNumber || 1)))
  params.set('page_size', String(Math.min(100, Math.max(1, opts.pageSize || 25))))
  if (opts.asin) params.set('asin', opts.asin.trim())
  // Confirmed working filter param is snake_case `brand_id` (camelCase is ignored).
  if (opts.brandId) params.set('brand_id', opts.brandId.trim())
  const data = await waywardFetch(`/amazon-attribution/products?${params.toString()}`, token)
  const products = Array.isArray(data?.products) ? data.products.map(mapProduct) : []
  return {
    products,
    pageNumber: asNum(data?.pageNumber) ?? 1,
    pageSize: asNum(data?.pageSize) ?? products.length,
    totalPages: asNum(data?.totalPages) ?? 1,
    totalProducts: asNum(data?.totalProducts) ?? products.length,
  }
}

/**
 * Mint an attributed Amazon link for an ASIN. Returns the ready-to-share
 * amazon.com/dp/<asin>?maas=… URL measured back to the creator's account.
 */
export async function createWaywardLink(token: string, asin: string): Promise<{ link: string; linkId: string }> {
  const a = (asin || '').trim()
  if (!/^[A-Z0-9]{10}$/i.test(a)) throw new Error('A valid 10-character ASIN is required.')
  const data = await waywardFetch('/amazon-attribution/links', token, {
    method: 'POST',
    body: JSON.stringify({ asin: a }),
  })
  const link = asStr(data?.link)
  if (!link) throw new Error('Wayward returned no link for that ASIN.')
  return { link, linkId: asStr(data?.linkId) }
}

/**
 * List brands the creator can earn on, with per-brand aggregates. Used to power
 * a brand filter (pick a brand → its products) and a "top-commission brands"
 * discovery view. The catalog products endpoint only supports pagination + an
 * exact ASIN + brand_id, so this brand list is how creators actually narrow 326k
 * products down.
 */
export async function getWaywardBrands(
  token: string,
  opts: { pageNumber?: number; pageSize?: number } = {},
): Promise<{ brands: WaywardBrand[]; pageNumber: number; totalPages: number }> {
  const params = new URLSearchParams()
  params.set('page_number', String(Math.max(1, opts.pageNumber || 1)))
  params.set('page_size', String(Math.min(200, Math.max(1, opts.pageSize || 100))))
  const data = await waywardFetch(`/amazon-attribution/brands?${params.toString()}`, token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brands: WaywardBrand[] = Array.isArray(data?.brands) ? data.brands.map((b: any) => ({
    id: asStr(b?.id),
    name: asStr(b?.name),
    avgCommission: asNum(b?.avg_commission),
    activeProductsCount: asNum(b?.active_products_count),
  })) : []
  return { brands, pageNumber: asNum(data?.pageNumber) ?? 1, totalPages: asNum(data?.totalPages) ?? 1 }
}
