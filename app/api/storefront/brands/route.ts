// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/storefront/brands — the brands a creator has worked with, scouted from
// their OWN connected Amazon storefront. SCOUT walks the public storefront and
// records every featured product in storefront_catalog (asin + title); this
// derives the brand from each product title (deriveProductName, deterministic —
// no API cost) and aggregates them into a deduped, ranked list. Own data only
// (RLS on storefront_catalog + the explicit user_id filter).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { deriveProductName } from '@/lib/product-name'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    // Brand per product: prefer the enriched brand column (Keepa), fall back to
    // deriving it from the title. Aggregate: brand → count + samples + thumbnail.
    const map = new Map<string, { brand: string; count: number; asins: string[]; image: string | null }>()
    let unknown = 0
    for (const r of rows) {
      const brand = (r.brand && r.brand.trim()) || deriveProductName(r.title).brand
      if (!brand) { unknown++; continue }
      const key = brand.toLowerCase()
      const cur = map.get(key) || { brand, count: 0, asins: [], image: null }
      cur.count += 1
      if (cur.asins.length < 6) cur.asins.push(r.asin)
      if (!cur.image && r.image_url) cur.image = r.image_url
      map.set(key, cur)
    }
    const brands = [...map.values()].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))

    return NextResponse.json({
      ok: true,
      hasData: true,
      totalProducts: rows.length,
      uniqueBrands: brands.length,
      unknown,
      brands,
    })
  } catch (e) {
    console.warn('[storefront/brands] GET error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true, hasData: false, brands: [], totalProducts: 0, uniqueBrands: 0, unknown: 0 })
  }
}
