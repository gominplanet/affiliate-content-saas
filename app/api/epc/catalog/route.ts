/**
 * GET /api/epc/catalog — the shared cross-user EPC discovery pool (migration 289).
 *   ?q=       search over product title + brand
 *   ?sort=    recent (default) | epc | rating | price_low | price_high
 *   ?minRating= only products at/above this star rating
 *   ?maxPrice= only products at/under this price (dollars)
 *   ?limit=   default 60, max 200
 *   ?offset=  pagination
 * Returns { ok, products, total } shaped like /api/epc/list rows (so the panel
 * reuses the same card), with the EPC value flagged as a REFERENCE. Keepa signals
 * (rank / monthly-sold / price history / deal) are merged in from the shared
 * keepa_product_cache (migration 288) by ASIN. Paid-tier only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, tierAllowsCampaigns } from '@/lib/tier'

export const dynamic = 'force-dynamic'

const SORTS: Record<string, { col: string; asc: boolean }> = {
  recent: { col: 'last_seen_at', asc: false },
  epc: { col: 'epc_value_ref', asc: false },
  rating: { col: 'rating', asc: false },
  price_low: { col: 'price_cents', asc: true },
  price_high: { col: 'price_cents', asc: false },
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsCampaigns(normalizeTier(ig?.tier))) {
    return NextResponse.json({ error: 'The EPC library is available on paid plans.' }, { status: 403 })
  }

  const p = new URL(request.url).searchParams
  const q = (p.get('q') || '').trim().replace(/[,%]/g, ' ').slice(0, 80)
  const sort = SORTS[p.get('sort') || 'recent'] || SORTS.recent
  const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 60))
  const offset = Math.max(0, Number(p.get('offset')) || 0)
  const minRating = Math.max(0, Math.min(5, Number(p.get('minRating')) || 0))
  const maxPriceCents = p.get('maxPrice') ? Math.round(Math.max(0, Number(p.get('maxPrice')) || 0) * 100) : 0

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('epc_catalog')
      .select('*', { count: 'exact' })
    if (q) query = query.or(`title.ilike.%${q}%,brand.ilike.%${q}%`)
    if (minRating > 0) query = query.gte('rating', minRating)
    if (maxPriceCents >= 1) query = query.lte('price_cents', maxPriceCents)
    query = query.order(sort.col, { ascending: sort.asc, nullsFirst: false }).range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ ok: true, products: [], total: 0 })
    const rows = (data ?? []) as Array<Record<string, unknown>>

    // Merge shared Keepa signals by ASIN (service-role — the cache is admin-only).
    const asins = rows.map((r) => String(r.asin))
    const keepaByAsin: Record<string, Record<string, unknown>> = {}
    if (asins.length) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: kc } = await (createAdminClient() as any)
          .from('keepa_product_cache')
          .select('asin, image_url, sales_rank, sales_rank_avg90, sales_rank_category, monthly_sold, price_now_cents, price_avg_cents, price_lowest_cents, discount_pct, deal_quality')
          .in('asin', asins)
        for (const k of (kc ?? [])) keepaByAsin[String(k.asin).toUpperCase()] = k
      } catch { /* cache table missing → no Keepa signals, catalog still lists */ }
    }

    // Shape each row like an /api/epc/list product so the panel reuses EpcCard.
    const products = rows.map((r) => {
      const asin = String(r.asin).toUpperCase()
      const k = keepaByAsin[asin] || {}
      const epcRef = r.epc_value_ref != null ? Number(r.epc_value_ref) : null
      return {
        asin,
        title: r.title ?? null,
        brand: r.brand ?? null,
        image_url: (r.image_url as string | null) || (k.image_url as string | null) || null,
        price_cents: (r.price_cents as number | null) ?? (k.price_now_cents as number | null) ?? null,
        epc_value: epcRef,
        // Clearly labeled as a reference value, not the user's exact Amazon number.
        epc_display: epcRef != null ? `~$${epcRef.toFixed(2)} ref` : null,
        budget: (r.budget_ref as string | null) ?? null,
        rating: (r.rating as number | null) ?? null,
        monthly_sold: (k.monthly_sold as number | null) ?? null,
        sales_rank: (k.sales_rank as number | null) ?? null,
        sales_rank_avg90: (k.sales_rank_avg90 as number | null) ?? null,
        sales_rank_category: (k.sales_rank_category as string | null) ?? null,
        price_now_cents: (k.price_now_cents as number | null) ?? null,
        price_avg_cents: (k.price_avg_cents as number | null) ?? null,
        price_lowest_cents: (k.price_lowest_cents as number | null) ?? null,
        discount_pct: (k.discount_pct as number | null) ?? null,
        deal_quality: (k.deal_quality as string | null) ?? null,
        ends_at: null,
        details_url: null,
        scanned_at: (r.last_seen_at as string) ?? new Date().toISOString(),
      }
    })
    return NextResponse.json({ ok: true, products, total: count ?? 0 })
  } catch {
    return NextResponse.json({ ok: true, products: [], total: 0 })
  }
}
