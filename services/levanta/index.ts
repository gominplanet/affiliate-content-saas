/**
 * Levanta Creator API v2 helpers. Powers the admin-only "MVP x Levanta" Labs
 * tool — browse your approved Amazon brands + products and mint a real
 * commissionable tracking link per ASIN.
 *
 * Token is passed in by the caller (server-only env LEVANTA_API_TOKEN today, a
 * per-user credential when this opens past admin) — never hardcoded.
 * Base: https://app.levanta.io/api/creator/v2 — Bearer auth, cursor pagination.
 */

const LEVANTA_BASE = 'https://app.levanta.io/api/creator/v2'

export interface LevantaBrand {
  brandId: string
  brandName: string
  bio: string
  image: string | null
  access: boolean // true = approved partnership (the "Joined"/"Partnered" state)
  url: string
  marketplace: string
}

export interface LevantaProduct {
  asin: string
  marketplace: string
  price: number | null
  currency: string | null
  commission: number | null // commission % offered to the creator
  title: string
  inStock: boolean
  category: string | null
  brandId: string | null
  access: boolean
  image: string | null
  rating: string | null
  ratingsTotal: number | null
  platformEpc: number | null // Levanta's modeled earnings-per-click
}

async function levantaFetch(path: string, token: string, init?: RequestInit, timeoutMs = 30_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${LEVANTA_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const text = await res.text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { /* non-JSON body */ }
    if (!res.ok) {
      const msg = json?.message || json?.error
      throw new Error(typeof msg === 'string' && msg ? `Levanta: ${msg}` : `Levanta error ${res.status}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/** List brands (cursor pagination). `access:true` = approved partnerships only. */
export async function listLevantaBrands(
  token: string,
  opts: { cursor?: string; limit?: number; access?: boolean; marketplace?: string } = {},
): Promise<{ brands: LevantaBrand[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  qs.set('limit', String(Math.min(Math.max(opts.limit ?? 100, 1), 100)))
  if (opts.cursor) qs.set('cursor', opts.cursor)
  if (opts.marketplace) qs.set('marketplace', opts.marketplace)
  if (opts.access != null) qs.set('access', String(opts.access))
  const json = await levantaFetch(`/brands?${qs.toString()}`, token)
  const list = Array.isArray(json?.brands) ? json.brands : []
  return {
    // Field names are read defensively — the live API has used keys that differ
    // from the published docs (e.g. the brand id arrived under `id`/`brand_id`,
    // not `brandId`), which left the products lookup with an empty id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brands: list.map((b: any): LevantaBrand => ({
      brandId: String(b.brandId ?? b.brand_id ?? b.id ?? ''),
      brandName: b.brandName ?? b.brand_name ?? b.name ?? '',
      bio: b.bio ?? b.description ?? '',
      image: b.image ?? b.logo ?? null,
      access: !!(b.access ?? b.partnered ?? b.hasAccess),
      url: b.url ?? b.brandUrl ?? b.site_url ?? '',
      marketplace: b.marketplace ?? '',
    })),
    cursor: json?.cursor ?? null,
  }
}

/** List products for one or more brands (cursor pagination). */
export async function listLevantaProducts(
  token: string,
  opts: { brandIds?: string; asins?: string; cursor?: string; limit?: number; access?: boolean; inStock?: boolean; marketplace?: string } = {},
): Promise<{ products: LevantaProduct[]; cursor: string | null }> {
  const qs = new URLSearchParams()
  qs.set('limit', String(Math.min(Math.max(opts.limit ?? 100, 1), 500)))
  if (opts.cursor) qs.set('cursor', opts.cursor)
  if (opts.brandIds) qs.set('brand_ids', opts.brandIds)
  if (opts.asins) qs.set('asins', opts.asins)
  if (opts.marketplace) qs.set('marketplace', opts.marketplace)
  if (opts.access != null) qs.set('access', String(opts.access))
  if (opts.inStock != null) qs.set('in_stock', String(opts.inStock))
  const json = await levantaFetch(`/products?${qs.toString()}`, token)
  const list = Array.isArray(json?.products) ? json.products : []
  return {
    // Defensive field reads — tolerate doc/live key drift (same reason as brands).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: list.map((p: any): LevantaProduct => {
      const bid = p.brandId ?? p.brand_id ?? p.brandID
      return {
        asin: p.asin ?? p.ASIN ?? p.primary_id ?? '',
        marketplace: p.marketplace ?? '',
        price: p?.pricing?.price ?? p.price ?? null,
        currency: p?.pricing?.currency ?? p.currency ?? null,
        commission: p.commission ?? p.commissionRate ?? p.commission_rate ?? null,
        title: p.title ?? p.name ?? p.product_name ?? '',
        inStock: !!(p.inStock ?? p.in_stock),
        category: p.category ?? null,
        brandId: bid != null ? String(bid) : null,
        access: !!p.access,
        image: p.image ?? p.imageUrl ?? p.image_url ?? null,
        rating: p.rating != null ? String(p.rating) : null,
        ratingsTotal: p.ratingsTotal ?? p.ratings_total ?? null,
        platformEpc: p.platformEpc ?? p.platform_epc ?? null,
      }
    }),
    cursor: json?.cursor ?? null,
  }
}

/**
 * Mint a commissionable tracking link for one product (synchronous).
 * POST /links { product: { primary_id: ASIN, marketplace }, subid1 } → { url }.
 */
export async function createLevantaLink(
  token: string,
  opts: { asin: string; marketplace?: string; subid1?: string },
): Promise<{ url: string; mobileUrl: string | null }> {
  const json = await levantaFetch('/links', token, {
    method: 'POST',
    body: JSON.stringify({
      product: { primary_id: opts.asin, marketplace: opts.marketplace || 'amazon.com' },
      ...(opts.subid1 ? { subid1: opts.subid1.slice(0, 256) } : {}),
    }),
  })
  return { url: json?.url ?? '', mobileUrl: json?.mobileOptimizedUrl ?? null }
}
