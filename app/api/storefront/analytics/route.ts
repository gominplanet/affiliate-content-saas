// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/storefront/analytics?period=weekly|monthly — the storefront analytics
// feed for the Amazon Influencer dashboard. Reads the SCOUT-synced
// storefront_earnings rows (units, revenue, commission, clicks per ASIN per
// period), rolls them into headline KPIs for the latest period, computes the
// period-over-period delta against the prior period, and returns a per-product
// table with each product's trend vs the prior period.
//
// Session-authed (owner reads their own rows). Amazon only reports products with
// a few shipments, so every row here is a PROVEN seller — this is the "what is
// actually selling" view, not an estimate.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaProductCard, keepaConfigured } from '@/services/keepa'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const money = (cents: number | null | undefined) => (cents == null ? 0 : Math.round(cents) / 100)
const ratio = (num: number, den: number) => (den > 0 ? num / den : 0)

interface Row {
  asin: string
  product_title: string | null
  period_type: string
  period_start: string
  period_end: string | null
  units: number | null
  revenue_cents: number | null
  commission_cents: number | null
  clicks: number | null
}

function totalsFor(rows: Row[]) {
  const revenue = rows.reduce((s, r) => s + money(r.revenue_cents), 0)
  const earnings = rows.reduce((s, r) => s + money(r.commission_cents), 0)
  const units = rows.reduce((s, r) => s + (r.units ?? 0), 0)
  const clicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0)
  return {
    earnings: Math.round(earnings * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    units,
    clicks,
    products: rows.length,
    conversion: Math.round(ratio(units, clicks) * 1000) / 10, // % units per click
    epc: Math.round(ratio(earnings, clicks) * 100) / 100,     // $ earnings per click
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const wanted = new URL(request.url).searchParams.get('period') === 'weekly' ? 'weekly' : 'monthly'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: allRows } = await sb
      .from('storefront_earnings')
      .select('asin,product_title,period_type,period_start,period_end,units,revenue_cents,commission_cents,clicks')
      .eq('user_id', user.id)
      .order('period_start', { ascending: false })
      .limit(2000)
    const rows = (allRows ?? []) as Row[]

    // How many distinct periods we have per type (drives the toggle's disabled state).
    const distinct = (t: string) => new Set(rows.filter(r => r.period_type === t).map(r => r.period_start)).size
    const available = { weekly: distinct('weekly'), monthly: distinct('monthly') }

    const ofType = rows.filter(r => r.period_type === wanted)
    if (ofType.length === 0) {
      return NextResponse.json({ period: wanted, hasData: false, available, latest: null, previous: null, totals: null, totalsPrev: null, products: [] })
    }

    // Latest + previous distinct period_starts (already sorted desc).
    const starts = [...new Set(ofType.map(r => r.period_start))]
    const latestStart = starts[0]
    const prevStart = starts[1] ?? null
    const latestRows = ofType.filter(r => r.period_start === latestStart)
    const prevRows = prevStart ? ofType.filter(r => r.period_start === prevStart) : []

    const totals = totalsFor(latestRows)
    const totalsPrev = prevStart ? totalsFor(prevRows) : null

    // Prior-period per-ASIN earnings, for per-product trend.
    const prevByAsin = new Map<string, number>()
    for (const r of prevRows) prevByAsin.set(r.asin, money(r.commission_cents))

    const products = latestRows
      .map(r => {
        const earnings = Math.round(money(r.commission_cents) * 100) / 100
        const revenue = Math.round(money(r.revenue_cents) * 100) / 100
        const units = r.units ?? 0
        const clicks = r.clicks ?? 0
        const prevEarnings = prevByAsin.has(r.asin) ? Math.round((prevByAsin.get(r.asin) ?? 0) * 100) / 100 : null
        return {
          asin: r.asin,
          title: r.product_title || r.asin,
          earnings,
          revenue,
          units,
          clicks,
          conversion: Math.round(ratio(units, clicks) * 1000) / 10,
          epc: Math.round(ratio(earnings, clicks) * 100) / 100,
          commissionPct: revenue > 0 ? Math.round((earnings / revenue) * 1000) / 10 : null,
          earningsPrev: prevEarnings,
          earningsDelta: prevEarnings == null ? null : Math.round((earnings - prevEarnings) * 100) / 100,
          isNew: prevStart != null && !prevByAsin.has(r.asin),
          amazonUrl: `https://www.amazon.com/dp/${r.asin}`,
        }
      })
      .sort((a, b) => b.earnings - a.earnings)

    // ── Garnish: Keepa demand/price (deal_radar_cache) + open CC campaign ──────
    // Enrich each product with a catalogue snapshot (image, price, ~monthly
    // demand, rating, discount) and whether the creator has an open Creator
    // Connections campaign for that ASIN — so the row can offer the right next
    // action (chase the brand deal, or just post).
    const asins = products.map(p => p.asin)
    const keepa = new Map<string, { image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null }>()
    const campByAsin = new Map<string, { name: string | null; status: string | null; campaignId: string | null; detailsUrl: string | null; brand: string | null; accepted: boolean }>()
    if (asins.length) {
      for (let i = 0; i < asins.length; i += 300) {
        const chunk = asins.slice(i, i + 300)
        // Our own storefront card cache first, then opportunistically the global
        // Deal Radar cache (a product the user also scanned there).
        const [{ data: cards }, { data: dr }] = await Promise.all([
          sb.from('storefront_product_cards').select('asin,image_url,price_now_cents,monthly_sold,rating,review_count,discount_pct').in('asin', chunk),
          sb.from('deal_radar_cache').select('asin,image_url,price_now_cents,monthly_sold,rating,review_count,discount_pct').in('asin', chunk),
        ])
        for (const r of (dr ?? []) as Array<{ asin: string; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null }>) keepa.set(r.asin, r)
        for (const r of (cards ?? []) as Array<{ asin: string; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null }>) keepa.set(r.asin, r) // prefer our fresher card
      }

      // Enrich anything still missing via Keepa (one /product call each, capped),
      // and cache it in storefront_product_cards so later loads are instant. This
      // is the first-load cost; after that it's a free read.
      const missing = asins.filter(a => !keepa.has(a)).slice(0, 30)
      if (keepaConfigured() && missing.length) {
        const titleByAsin = new Map(products.map(p => [p.asin, p.title]))
        const CONC = 6
        const nowIso = new Date().toISOString()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upserts: any[] = []
        for (let i = 0; i < missing.length; i += CONC) {
          const batch = missing.slice(i, i + CONC)
          const cards = await Promise.all(batch.map(a => fetchKeepaProductCard(a).catch(() => null)))
          batch.forEach((a, idx) => {
            const c = cards[idx]
            if (!c) return
            keepa.set(a, { image_url: c.imageUrl, price_now_cents: c.priceNowCents, monthly_sold: c.monthlySold, rating: c.rating, review_count: c.reviewCount, discount_pct: c.discountPct })
            upserts.push({
              asin: a,
              title: (titleByAsin.get(a) || a).slice(0, 300),
              image_url: c.imageUrl,
              price_now_cents: c.priceNowCents,
              price_was_cents: c.priceWasCents,
              discount_pct: c.discountPct,
              rating: c.rating,
              review_count: c.reviewCount,
              monthly_sold: c.monthlySold,
              refreshed_at: nowIso,
            })
          })
        }
        if (upserts.length) {
          // Service-role write (RLS only grants SELECT to users — see migration 253).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await (createAdminClient() as any).from('storefront_product_cards').upsert(upserts, { onConflict: 'asin' }) } catch { /* cache best-effort */ }
        }
      }

      const { data: camps } = await sb
        .from('campaigns')
        .select('asin,campaign_name,status,cc_campaign_id,details_url,brand_name,accepted_at')
        .eq('user_id', user.id)
        .in('asin', asins)
      for (const c of (camps ?? []) as Array<{ asin: string | null; campaign_name: string | null; status: string | null; cc_campaign_id: string | null; details_url: string | null; brand_name: string | null; accepted_at: string | null }>) {
        if (c.asin && !campByAsin.has(c.asin)) {
          campByAsin.set(c.asin, {
            name: c.campaign_name,
            status: c.status,
            campaignId: c.cc_campaign_id,
            detailsUrl: c.details_url,
            brand: c.brand_name,
            accepted: !!c.accepted_at,
          })
        }
      }
    }

    const enriched = products.map(p => {
      const e = keepa.get(p.asin)
      return {
        ...p,
        image: e?.image_url ?? null,
        priceNow: e?.price_now_cents != null ? Math.round(e.price_now_cents) / 100 : null,
        monthlySold: e?.monthly_sold ?? null,
        rating: e?.rating != null ? Number(e.rating) : null,
        reviewCount: e?.review_count ?? null,
        discountPct: e?.discount_pct != null ? Number(e.discount_pct) : null,
        campaign: campByAsin.get(p.asin) ?? null,
      }
    })

    const end = latestRows[0]?.period_end ?? null
    return NextResponse.json({
      period: wanted,
      hasData: true,
      available,
      latest: { start: latestStart, end },
      previous: prevStart ? { start: prevStart } : null,
      totals,
      totalsPrev,
      products: enriched,
    })
  } catch (e) {
    console.warn('[storefront/analytics] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not load analytics.' }, { status: 500 })
  }
}
