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

export const dynamic = 'force-dynamic'

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

    const end = latestRows[0]?.period_end ?? null
    return NextResponse.json({
      period: wanted,
      hasData: true,
      available,
      latest: { start: latestStart, end },
      previous: prevStart ? { start: prevStart } : null,
      totals,
      totalsPrev,
      products,
    })
  } catch (e) {
    console.warn('[storefront/analytics] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not load analytics.' }, { status: 500 })
  }
}
