// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/keepa-price-probe?q=<keyword>   (admin only)
//
// Read-only diagnostic for the "catalog price doesn't match the Amazon page"
// bug. For the top catalog rows matching a keyword, it shows side by side:
//   - what the catalog has STORED (price_now_cents)
//   - the RAW Keepa price fields, live: Amazon(0), New(1), Buy Box(18) +
//     stats.buyBoxPrice
//   - the campaign's rep_asin and full asins[] (to catch a wrong-ASIN mapping)
//
// So we can tell, at a glance, whether the stored price is stale, whether Buy
// Box data is even coming back, and whether the priced ASIN is the right one.
// Spends a few Keepa tokens (one /product call per row, capped).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEEPA_BASE = 'https://api.keepa.com'
const PROBE_CAP = 8

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const key = process.env.KEEPA_API_KEY
  if (!key) return NextResponse.json({ error: 'Keepa not configured' }, { status: 400 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  const asinParam = (url.searchParams.get('asin') || '').trim().toUpperCase()

  const admin = createAdminClient()

  // Build the ASIN work-list: either a single ?asin, or the top catalog rows for ?q.
  type Row = { campaign_id: string; campaign_name: string; brand_name: string | null; asins: string[]; rep_asin: string | null; price_now_cents: number | null; product_verified_at: string | null }
  let rows: Row[] = []
  if (asinParam && /^[A-Z0-9]{10}$/.test(asinParam)) {
    rows = [{ campaign_id: '(direct)', campaign_name: '(direct ASIN)', brand_name: null, asins: [asinParam], rep_asin: asinParam, price_now_cents: null, product_verified_at: null }]
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (admin as any)
      .from('cc_campaign_catalog')
      .select('campaign_id, campaign_name, brand_name, asins, rep_asin, price_now_cents, product_verified_at')
      .not('rep_asin', 'is', null)
      .order('commission_pct', { ascending: false })
      .limit(PROBE_CAP)
    if (q) query = query.textSearch('search_vec', q, { type: 'websearch' })
    const { data, error } = await query
    if (error) return NextResponse.json({ error: 'catalog query failed', detail: error.message }, { status: 200 })
    rows = (data ?? []) as Row[]
  }

  const cents = (n: unknown) => (Number.isFinite(n) && (n as number) >= 0 ? (n as number) : null)

  const results = await Promise.all(rows.slice(0, PROBE_CAP).map(async (r) => {
    const asin = (r.rep_asin || r.asins?.[0] || '').toUpperCase()
    const base = {
      campaignName: r.campaign_name,
      brand: r.brand_name,
      repAsin: r.rep_asin,
      asins: r.asins,
      storedCents: r.price_now_cents,
      verifiedAt: r.product_verified_at,
      asinPriced: asin || null,
    }
    if (!/^[A-Z0-9]{10}$/.test(asin)) return { ...base, error: 'no valid rep asin' }
    try {
      const purl = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=1&asin=${asin}&stats=90&history=0&buybox=1`
      const res = await fetch(purl, { signal: AbortSignal.timeout(25_000) })
      if (!res.ok) return { ...base, error: `keepa http ${res.status}` }
      const data = await res.json() as { products?: unknown[] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (Array.isArray(data.products) ? (data.products[0] as any) : null)
      const stats = p?.stats || {}
      const cur = Array.isArray(stats.current) ? stats.current : []
      const amazonCents = cents(cur[0])
      const newCents = cents(cur[1])
      const buyBoxCurrentCents = cents(cur[18])
      const buyBoxPriceField = cents(stats.buyBoxPrice)
      // Image diagnostics: which field carries the image on THIS response shape.
      // The EPC library cards were blank while rank/sold filled, so we surface the
      // raw fields to see whether imagesCSV / images[] come back at all here.
      const imagesArrFirst = Array.isArray(p?.images) && p.images[0] ? p.images[0] : null
      const imageProbe = {
        imagesCSV: typeof p?.imagesCSV === 'string' ? p.imagesCSV.slice(0, 160) : null,
        imagesArrayLen: Array.isArray(p?.images) ? p.images.length : null,
        imagesArrayFirst: imagesArrFirst,
        imageField: typeof p?.image === 'string' ? p.image.slice(0, 160) : null,
        resolvedFromCsv: (typeof p?.imagesCSV === 'string' && p.imagesCSV.trim())
          ? `https://m.media-amazon.com/images/I/${p.imagesCSV.split(',')[0]}` : null,
        resolvedFromArray: (imagesArrFirst && (imagesArrFirst.l || imagesArrFirst.m))
          ? `https://m.media-amazon.com/images/I/${imagesArrFirst.l || imagesArrFirst.m}` : null,
      }
      // Same preference as statPriceBuyBox: Buy Box field → Buy Box current →
      // Amazon → New. This is the corrected "what you pay" price.
      const correctedCents = buyBoxPriceField ?? buyBoxCurrentCents ?? amazonCents ?? newCents
      // Fix the row in place: probing top rows doubles as a bounded, no-timeout
      // manual refresh (≤8 rows) so the stored price matches the Buy Box amount
      // immediately, and priced_v2=true keeps the cron from redoing it.
      let fixedToCents: number | null = null
      if (correctedCents != null && r.rep_asin) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('cc_campaign_catalog')
            .update({ price_now_cents: correctedCents, priced_v2: true, product_verified_at: new Date().toISOString() })
            .eq('rep_asin', r.rep_asin)
          fixedToCents = correctedCents
        } catch { /* leave as diagnostic-only if the write fails */ }
      }
      return {
        ...base,
        fixedToCents,
        keepa: { amazonCents, newCents, buyBoxCurrentCents, buyBoxPriceField, avg90BuyBoxCents: Array.isArray(stats.avg90) ? cents(stats.avg90[18]) : null },
        image: imageProbe,
      }
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message.slice(0, 120) : 'exception' }
    }
  }))

  return NextResponse.json({ ok: true, q: q || null, asin: asinParam || null, count: results.length, results })
}
