// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Storefront catalog: every product the creator features on their PUBLIC
// storefront (past the ~100-row earnings cap). SCOUT walks the public
// storefront's idea lists and POSTs the ASIN/title/image set here (session
// cookie auth, service-role write). GET returns the full catalog with the
// creator's REAL earnings overlaid (from storefront_earnings, ytd, all sources).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': 'https://www.amazon.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }) }

const ASIN_RE = /^[A-Z0-9]{10}$/
interface CatalogIn { asin?: string; title?: string; image?: string; listTitle?: string }

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: CORS })

    const body = await request.json().catch(() => ({})) as { products?: CatalogIn[] }
    const products = Array.isArray(body.products) ? body.products : []
    const rows = products
      .map((p) => {
        const asin = String(p.asin ?? '').trim().toUpperCase()
        if (!ASIN_RE.test(asin)) return null
        return {
          user_id: user.id,
          asin,
          title: (p.title ?? '').toString().trim().slice(0, 300) || null,
          image_url: (p.image ?? '').toString().trim().slice(0, 1000) || null,
          list_title: (p.listTitle ?? '').toString().trim().slice(0, 200) || null,
          synced_at: new Date().toISOString(),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, 5000)
    if (!rows.length) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('storefront_catalog')
      .upsert(rows, { onConflict: 'user_id,asin' })
    if (error) {
      console.warn('[storefront/catalog] upsert failed:', error.message)
      return NextResponse.json({ error: 'Could not save catalog.' }, { status: 500, headers: CORS })
    }
    return NextResponse.json({ ok: true, upserted: rows.length }, { headers: CORS })
  } catch (e) {
    console.warn('[storefront/catalog] POST error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Catalog ingest failed.' }, { status: 500, headers: CORS })
  }
}

const money = (c: number | null | undefined) => (c == null ? 0 : Math.round(c) / 100)

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: cat } = await sb
      .from('storefront_catalog')
      .select('asin,title,image_url,list_title')
      .eq('user_id', user.id)
      .limit(5000)
    const catalog = (cat ?? []) as Array<{ asin: string; title: string | null; image_url: string | null; list_title: string | null }>
    if (!catalog.length) return NextResponse.json({ ok: true, hasData: false, products: [], total: 0 })

    // Overlay the creator's REAL earnings (ytd, all sources summed per ASIN).
    const { data: earn } = await sb
      .from('storefront_earnings')
      .select('asin,units,revenue_cents,commission_cents,clicks')
      .eq('user_id', user.id)
      .eq('period_type', 'ytd')
      .limit(5000)
    const byAsin = new Map<string, { earnings: number; revenue: number; units: number; clicks: number }>()
    for (const r of (earn ?? []) as Array<{ asin: string; units: number | null; revenue_cents: number | null; commission_cents: number | null; clicks: number | null }>) {
      const cur = byAsin.get(r.asin) || { earnings: 0, revenue: 0, units: 0, clicks: 0 }
      cur.earnings += money(r.commission_cents)
      cur.revenue += money(r.revenue_cents)
      cur.units += r.units ?? 0
      cur.clicks += r.clicks ?? 0
      byAsin.set(r.asin, cur)
    }

    const products = catalog.map((c) => {
      const e = byAsin.get(c.asin)
      const earnings = e ? Math.round(e.earnings * 100) / 100 : 0
      const clicks = e?.clicks ?? 0
      const units = e?.units ?? 0
      return {
        asin: c.asin,
        title: c.title || c.asin,
        image: c.image_url,
        listTitle: c.list_title,
        earnings,
        revenue: e ? Math.round(e.revenue * 100) / 100 : 0,
        units,
        clicks,
        conversion: clicks > 0 ? Math.round((units / clicks) * 1000) / 10 : 0,
        epc: clicks > 0 ? Math.round((earnings / clicks) * 100) / 100 : 0,
        hasEarnings: !!e,
        amazonUrl: `https://www.amazon.com/dp/${c.asin}`,
      }
    }).sort((a, b) => b.earnings - a.earnings || (a.title || '').localeCompare(b.title || ''))

    const withEarnings = products.filter((p) => p.hasEarnings).length
    return NextResponse.json({ ok: true, hasData: true, total: products.length, withEarnings, products })
  } catch (e) {
    console.warn('[storefront/catalog] GET error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true, hasData: false, products: [], total: 0 })
  }
}
