// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/storefront/brands — the brands a creator has worked with, scouted from
// their OWN connected Amazon storefront. SCOUT walks the public storefront and
// records every featured product in storefront_catalog (asin + title); this
// derives the brand from each product title (deriveProductName, deterministic —
// no API cost) and aggregates them into a deduped, ranked list. Each brand carries
// its products (asin + title + image) and a Creator Connections flag: whether any
// of the brand's products has a LIVE CC campaign, so the UI can offer a "Message
// the brand" action. Own data only (RLS on storefront_catalog + user_id filter).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deriveProductName, cleanBrand } from '@/lib/product-name'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface BrandProduct { asin: string; title: string | null; image: string | null }
interface BrandOut {
  brand: string
  count: number
  image: string | null
  products: BrandProduct[]
  cc: boolean                       // any product live on Creator Connections
  ccCommissionPct: number | null    // best commission % seen across matched campaigns
}

const PRODUCTS_PER_BRAND = 24 // cap the product list we return per brand

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: cat } = await sb
      .from('storefront_catalog')
      .select('asin,title,image_url,brand')
      .eq('user_id', user.id)
      .limit(5000)
    const rows = (cat ?? []) as Array<{ asin: string; title: string | null; image_url: string | null; brand: string | null }>
    if (!rows.length) return NextResponse.json({ ok: true, hasData: false, brands: [], totalProducts: 0, uniqueBrands: 0, unknown: 0 })

    // Brand per product: prefer the enriched brand column, else derive from the
    // title. Both go through cleanBrand so a doubled scrape ("GoveeLife GoveeLife")
    // and "…Store" scaffolding are normalized the same way. Aggregate into
    // brand → { count, products, thumbnail }.
    const map = new Map<string, { brand: string; count: number; products: BrandProduct[]; image: string | null }>()
    const asinToBrandKey = new Map<string, string>() // for the CC match pass
    let unknown = 0
    for (const r of rows) {
      const brand = cleanBrand(r.brand) || deriveProductName(r.title).brand
      if (!brand) { unknown++; continue }
      const key = brand.toLowerCase()
      const cur = map.get(key) || { brand, count: 0, products: [], image: null }
      cur.count += 1
      if (cur.products.length < PRODUCTS_PER_BRAND) cur.products.push({ asin: r.asin, title: r.title, image: r.image_url })
      if (!cur.image && r.image_url) cur.image = r.image_url
      map.set(key, cur)
      if (!asinToBrandKey.has(r.asin)) asinToBrandKey.set(r.asin, key)
    }

    // Creator Connections match: which of these products has a LIVE campaign? One
    // GIN-indexed anti-join over the shared catalog (cc_campaign_catalog.asins),
    // instead of a per-ASIN lookup. Mark each brand cc=true when any of its
    // products is covered, and keep the best commission % seen for the card.
    const ccByBrandKey = new Map<string, { commissionPct: number | null }>()
    try {
      const allAsins = [...asinToBrandKey.keys()]
      if (allAsins.length) {
        const admin = createAdminClient()
        const today = new Date().toISOString().slice(0, 10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: camps } = await (admin as any)
          .from('cc_campaign_catalog')
          .select('asins, brand_name, commission_pct, ends_at')
          .overlaps('asins', allAsins)
          .gte('ends_at', today)
          .limit(4000)
        for (const c of (camps ?? []) as Array<{ asins: string[] | null; commission_pct: number | null }>) {
          const pct = typeof c.commission_pct === 'number' ? c.commission_pct : null
          for (const a of (c.asins ?? [])) {
            const key = asinToBrandKey.get(a)
            if (!key) continue
            const prev = ccByBrandKey.get(key)
            const best = Math.max(prev?.commissionPct ?? 0, pct ?? 0) || null
            ccByBrandKey.set(key, { commissionPct: best })
          }
        }
      }
    } catch { /* CC catalog absent or query failed → no CC badges, list still works */ }

    const brands: BrandOut[] = [...map.entries()]
      .map(([key, v]) => {
        const cc = ccByBrandKey.get(key)
        return {
          brand: v.brand,
          count: v.count,
          image: v.image,
          products: v.products,
          cc: !!cc,
          ccCommissionPct: cc?.commissionPct ?? null,
        }
      })
      .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))

    return NextResponse.json({
      ok: true,
      hasData: true,
      totalProducts: rows.length,
      uniqueBrands: brands.length,
      unknown,
      ccCount: brands.filter(b => b.cc).length,
      brands,
    })
  } catch (e) {
    console.warn('[storefront/brands] GET error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true, hasData: false, brands: [], totalProducts: 0, uniqueBrands: 0, unknown: 0 })
  }
}
