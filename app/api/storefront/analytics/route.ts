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

    const pq = new URL(request.url).searchParams.get('period')
    const wanted = pq === 'weekly' ? 'weekly' : pq === 'ytd' ? 'ytd' : 'monthly'

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
    const available = { weekly: distinct('weekly'), monthly: distinct('monthly'), ytd: distinct('ytd') }

    const ofType = rows.filter(r => r.period_type === wanted)
    if (ofType.length === 0) {
      return NextResponse.json({ period: wanted, hasData: false, available, latest: null, previous: null, totals: null, totalsPrev: null, products: [] })
    }

    // A product can hold more than one row per period_start when sources differ
    // (regular commissions + a Creator Connections campaign on the same ASIN in
    // the same year). Merge by ASIN so the storefront sums both into one line.
    const mergeByAsin = (input: Row[]): Row[] => {
      const m = new Map<string, Row>()
      for (const r of input) {
        const cur = m.get(r.asin)
        if (!cur) { m.set(r.asin, { ...r }); continue }
        // COMMISSION is additive across sources (regular + Creator Connections are
        // separate income on the same product). UNITS / REVENUE / CLICKS are the
        // product's whole-account figures, reported ONCE; a second source row can
        // repeat the same number, so take the MAX, never the sum, or the product
        // (and the totals summed from it) double-count.
        cur.units = Math.max(cur.units ?? 0, r.units ?? 0)
        cur.revenue_cents = Math.max(cur.revenue_cents ?? 0, r.revenue_cents ?? 0)
        cur.commission_cents = (cur.commission_cents ?? 0) + (r.commission_cents ?? 0)
        cur.clicks = Math.max(cur.clicks ?? 0, r.clicks ?? 0)
        if (!cur.product_title && r.product_title) cur.product_title = r.product_title
      }
      return [...m.values()]
    }

    // Latest + previous distinct period_starts (already sorted desc).
    const starts = [...new Set(ofType.map(r => r.period_start))]
    const latestStart = starts[0]
    const prevStart = starts[1] ?? null
    const latestRows = mergeByAsin(ofType.filter(r => r.period_start === latestStart))
    const prevRows = prevStart ? mergeByAsin(ofType.filter(r => r.period_start === prevStart)) : []

    const totals = totalsFor(latestRows)
    const totalsPrev = prevStart ? totalsFor(prevRows) : null

    // Authoritative headline: Amazon's summary totals (all products), which beat
    // summing the ~100-row product cap. Read the period_totals rows SCOUT landed
    // for this period, sum across sources (commissions + CC), and override the
    // product-sum headline for any metric we actually have. Product-sum stays
    // the fallback (and always drives the per-product list + charts).
    let totalsSource: 'summary' | 'products' = 'products'
    try {
      const { data: totRows } = await sb
        .from('storefront_period_totals')
        .select('period_type,period_start,source,earnings_cents,revenue_cents,units,clicks')
        .eq('user_id', user.id)
        .eq('period_type', wanted)
        .eq('period_start', latestStart)
      const tr = (totRows ?? []) as Array<{ earnings_cents: number | null; revenue_cents: number | null; units: number | null; clicks: number | null }>
      if (tr.length) {
        // EARNINGS is the one additive metric: Commissions and Creator Connections
        // are separate income streams, so SUM them — this is Amazon's Summary total.
        const sEarn = tr.reduce((s, r) => s + money(r.earnings_cents), 0)
        // CLICKS / REVENUE / UNITS are whole-account figures Amazon reports ONCE.
        // A per-source row can repeat the same global number (the Creator
        // Connections row carrying the account's click count too), so take the MAX
        // across sources, never the sum. Summing is what doubled clicks and halved
        // conversion on accounts with more than one income source.
        const mRev = tr.reduce((s, r) => Math.max(s, money(r.revenue_cents)), 0)
        const mUnits = tr.reduce((s, r) => Math.max(s, r.units ?? 0), 0)
        const mClicks = tr.reduce((s, r) => Math.max(s, r.clicks ?? 0), 0)
        // These period_totals are SCOUT's parse of Amazon's own summary tiles — the
        // authoritative "all products" figure — so use them whenever present and
        // positive. The product-sum fallback double-counts any product that earns
        // through BOTH sources, so it is NOT a valid floor: the old ">= product-sum"
        // guard let that inflated sum win and corrupt the headline (earnings and
        // clicks both read high).
        if (sEarn > 0) { totals.earnings = Math.round(sEarn * 100) / 100; totalsSource = 'summary' }
        if (mRev > 0) totals.revenue = Math.round(mRev * 100) / 100
        if (mUnits > 0) totals.units = mUnits
        if (mClicks > 0) totals.clicks = mClicks
        // Recompute the derived ratios off the authoritative figures.
        totals.conversion = Math.round(ratio(totals.units, totals.clicks) * 1000) / 10
        totals.epc = Math.round(ratio(totals.earnings, totals.clicks) * 100) / 100
      }
    } catch { /* totals table absent (migration 269 not run) — product-sum stands */ }

    // ── Snapshot-based trend (migration 273) ──────────────────────────────────
    // When there's no prior PERIOD (the norm for YTD — only ever one period_start
    // this year), fall back to a dated snapshot of the headline totals so the
    // KPI deltas aren't permanently dead. Compare the newest snapshot vs earlier
    // one; the delta reads "since <that date>". Only kicks in when period-based
    // totalsPrev is absent, so weekly/monthly keep true period-over-period.
    let headlinePrev = totalsPrev
    let trendBasis: 'period' | 'snapshot' | null = totalsPrev ? 'period' : null
    let trendSince: string | null = null
    if (!headlinePrev) {
      try {
        const { data: snaps } = await sb
          .from('storefront_snapshots')
          .select('taken_on,earnings_cents,revenue_cents,units,clicks')
          .eq('user_id', user.id)
          .eq('period_type', wanted)
          .order('taken_on', { ascending: false })
          .limit(60)
        const sr = (snaps ?? []) as Array<{ taken_on: string; earnings_cents: number | null; revenue_cents: number | null; units: number | null; clicks: number | null }>
        // Newest snapshot ≈ current; use the most recent OLDER one as the prior
        // point. Skip a same-value older snapshot only if earnings are identical
        // (nothing changed — showing a 0% "since" is noise).
        if (sr.length >= 2) {
          const newest = sr[0]
          const prior = sr.find(s => s.taken_on < newest.taken_on && money(s.earnings_cents) !== money(newest.earnings_cents))
            ?? sr.find(s => s.taken_on < newest.taken_on)
          if (prior) {
            const pEarn = money(prior.earnings_cents)
            const pRev = money(prior.revenue_cents)
            const pUnits = prior.units ?? 0
            const pClicks = prior.clicks ?? 0
            headlinePrev = {
              earnings: Math.round(pEarn * 100) / 100,
              revenue: Math.round(pRev * 100) / 100,
              units: pUnits,
              clicks: pClicks,
              products: 0,
              conversion: Math.round(ratio(pUnits, pClicks) * 1000) / 10,
              epc: Math.round(ratio(pEarn, pClicks) * 100) / 100,
            }
            trendBasis = 'snapshot'
            trendSince = prior.taken_on
          }
        }
      } catch { /* snapshots table absent (migration 273 not run) — no trend */ }
    }

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
    const keepa = new Map<string, { image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null; category: string | null }>()
    const campByAsin = new Map<string, { name: string | null; status: string | null; campaignId: string | null; detailsUrl: string | null; brand: string | null; accepted: boolean }>()
    if (asins.length) {
      for (let i = 0; i < asins.length; i += 300) {
        const chunk = asins.slice(i, i + 300)
        // Our own storefront card cache first, then opportunistically the global
        // Deal Radar cache (a product the user also scanned there).
        const [{ data: cards }, { data: dr }] = await Promise.all([
          sb.from('storefront_product_cards').select('asin,image_url,price_now_cents,monthly_sold,rating,review_count,discount_pct,category').in('asin', chunk),
          sb.from('deal_radar_cache').select('asin,image_url,price_now_cents,monthly_sold,rating,review_count,discount_pct').in('asin', chunk),
        ])
        for (const r of (dr ?? []) as Array<{ asin: string; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null }>) keepa.set(r.asin, { ...r, category: null })
        for (const r of (cards ?? []) as Array<{ asin: string; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; rating: number | null; review_count: number | null; discount_pct: number | null; category: string | null }>) keepa.set(r.asin, r) // prefer our fresher card
      }

      // Enrich via Keepa (one /product call each, capped) anything MISSING, plus
      // cached rows that predate the category column (so category backfills over
      // a few loads). Cached in storefront_product_cards so later loads are free.
      const needsCategory = [...keepa.entries()].filter(([, v]) => v.category == null).map(([a]) => a)
      const missing = [...new Set([...asins.filter(a => !keepa.has(a)), ...needsCategory])].slice(0, 30)
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
            keepa.set(a, { image_url: c.imageUrl, price_now_cents: c.priceNowCents, monthly_sold: c.monthlySold, rating: c.rating, review_count: c.reviewCount, discount_pct: c.discountPct, category: c.category })
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
              category: c.category,
              parent_asin: c.parentAsin,
              sales_rank: c.salesRank,
              sales_rank_avg90: c.salesRankAvg90,
              sales_rank_category: c.salesRankCategory,
              listed_since: c.listedSince,
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
        category: e?.category ?? null,
        campaign: campByAsin.get(p.asin) ?? null,
      }
    })

    // Time-series: totals per period (oldest→newest) for the trend chart.
    // Grouped from the same period-type rows. Capped at 52 points so a full
    // year of weeks — or years of months — of captured history all shows,
    // instead of the old 12-period window that hid most backfilled data.
    const byPeriod = new Map<string, Row[]>()
    for (const r of ofType) {
      const arr = byPeriod.get(r.period_start)
      if (arr) arr.push(r); else byPeriod.set(r.period_start, [r])
    }
    const series = [...byPeriod.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-52)
      .map(([start, rows]) => {
        const t = totalsFor(rows)
        return { start, earnings: t.earnings, revenue: t.revenue, units: t.units, clicks: t.clicks, conversion: t.conversion, epc: t.epc }
      })

    // History coverage for the current period type — powers the "X periods
    // captured, earliest MMM YYYY" indicator + the backfill nudge.
    const coverage = {
      periods: starts.length,
      earliestStart: starts.length ? starts[starts.length - 1] : null,
      latestStart: starts[0] ?? null,
    }

    const end = latestRows[0]?.period_end ?? null
    return NextResponse.json({
      period: wanted,
      hasData: true,
      available,
      coverage,
      latest: { start: latestStart, end },
      previous: prevStart ? { start: prevStart } : null,
      totals,
      totalsPrev: headlinePrev,
      trendBasis,
      trendSince,
      totalsSource,
      productCount: products.length,
      series,
      products: enriched,
    })
  } catch (e) {
    console.warn('[storefront/analytics] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not load analytics.' }, { status: 500 })
  }
}
