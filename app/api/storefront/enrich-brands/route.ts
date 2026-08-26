// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/storefront/enrich-brands — fill the real BRAND (and a clean title +
// image where missing) on the creator's storefront_catalog products. Works off
// the ASINs already synced, so it improves the catalog + the "Brands you've
// featured" view WITHOUT any storefront re-scrape. One bounded batch per call
// (returns how many remain) so a big catalog enriches over a few clicks/ticks.
//
// Enrichment source is internal and MUST NEVER be surfaced to users.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { keepaConfigured, fetchKeepaBrandInfo } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ASIN_RE = /^[A-Z0-9]{10}$/

// GET — how much of the catalog has a brand yet (drives the UI progress line).
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const total = (await sb.from('storefront_catalog').select('asin', { count: 'exact', head: true }).eq('user_id', user.id)).count ?? 0
    const withBrand = (await sb.from('storefront_catalog').select('asin', { count: 'exact', head: true }).eq('user_id', user.id).not('brand', 'is', null)).count ?? 0
    return NextResponse.json({ ok: true, configured: keepaConfigured(), total, withBrand, remaining: Math.max(0, total - withBrand) })
  } catch {
    return NextResponse.json({ ok: false, configured: keepaConfigured(), total: 0, withBrand: 0, remaining: 0 })
  }
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    if (!keepaConfigured()) return NextResponse.json({ ok: false, configured: false, enriched: 0, remaining: 0 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    // Batch of not-yet-enriched rows (brand_synced_at null). 200/call → 2 Keepa
    // /product calls, well within the request window.
    const { data: rows } = await sb
      .from('storefront_catalog')
      .select('asin,title')
      .eq('user_id', user.id)
      .is('brand_synced_at', null)
      .limit(200)
    const pending = (rows ?? []) as Array<{ asin: string; title: string | null }>
    if (!pending.length) {
      const total = (await sb.from('storefront_catalog').select('asin', { count: 'exact', head: true }).eq('user_id', user.id)).count ?? 0
      const withBrand = (await sb.from('storefront_catalog').select('asin', { count: 'exact', head: true }).eq('user_id', user.id).not('brand', 'is', null)).count ?? 0
      return NextResponse.json({ ok: true, configured: true, enriched: 0, remaining: 0, total, withBrand })
    }

    const asins = pending.map((r) => r.asin).filter((a) => ASIN_RE.test(a))
    const info = await fetchKeepaBrandInfo(asins)

    const admin = createAdminClient()
    const now = new Date().toISOString()
    let enriched = 0
    for (const row of pending) {
      const hit = info.get(row.asin.toUpperCase())
      // Always stamp brand_synced_at so an ASIN Keepa can't resolve isn't retried
      // forever; only overwrite title when the stored one was just the ASIN.
      const patch: Record<string, unknown> = { brand_synced_at: now }
      if (hit?.brand) { patch.brand = hit.brand; enriched++ }
      const titleIsAsin = !row.title || row.title.trim().toUpperCase() === row.asin.toUpperCase()
      if (titleIsAsin && hit?.title) patch.title = hit.title
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('storefront_catalog').update(patch).eq('user_id', user.id).eq('asin', row.asin)
    }

    const remaining = (await sb.from('storefront_catalog').select('asin', { count: 'exact', head: true }).eq('user_id', user.id).is('brand_synced_at', null)).count ?? 0
    return NextResponse.json({ ok: true, configured: true, enriched, remaining })
  } catch (e) {
    console.warn('[storefront/enrich-brands]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, configured: keepaConfigured(), enriched: 0, remaining: 0 }, { status: 500 })
  }
}
