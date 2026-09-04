// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-earnings/products — the per-ASIN breakdown behind the totals.
//
// The monthly totals say how much a creator made. This says which products made
// it, which month they made it in, and whether each one is climbing or sliding.
// That difference is the whole feature: a total is a scoreboard, a per-product
// trend is something you can act on tomorrow.
//
// Three rules this route holds to, all of them the same rule:
//   1. A null is never turned into a zero. Amazon hides low-volume figures, and
//      "hidden" and "earned nothing" are not the same claim.
//   2. A trend is only computed when BOTH months reported. One month of data is
//      not a direction, and drawing an arrow off it would be inventing one.
//   3. The newest month is partial by definition, so it is never used as the
//      recent side of a comparison. Four days against thirty-one reads as a
//      collapse in every product on the list.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProductRow {
  period_start: string; stream: string; store_id: string; store_scope: string | null
  asin: string; product_title: string | null
  clicks: number | null; orders: number | null; quantity: number | null
  earnings_cents: number | null; revenue_cents: number | null
}

interface Agg {
  asin: string
  title: string | null
  earningsCents: number | null
  revenueCents: number | null
  clicks: number | null
  orders: number | null
  months: Record<string, number>
  streams: string[]
  scopes: string[]
}

/** Adds where a value exists, and stays null when nothing ever did. */
function adder() {
  let total = 0, seen = false
  return {
    add(v: number | null | undefined) { if (v == null) return; total += v; seen = true },
    get value() { return seen ? total : null },
  }
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('amazon_earnings_products')
    .select('period_start,stream,store_id,store_scope,asin,product_title,clicks,orders,quantity,earnings_cents,revenue_cents')
    .eq('user_id', user.id)
  if (from) q = q.gte('period_start', from)
  if (to) q = q.lte('period_start', to)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message, products: [], synced: false }, { status: 200 })
  }
  const rows = (data ?? []) as ProductRow[]

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, synced: false, products: [], months: [], coverage: null })
  }

  // Roll every stream and store up to one line per product. A creator thinks in
  // products, not in the four ways Amazon happens to file the same sale.
  const map = new Map<string, Agg & { e: ReturnType<typeof adder>; r: ReturnType<typeof adder>; c: ReturnType<typeof adder>; o: ReturnType<typeof adder> }>()
  const monthSet = new Set<string>()

  for (const row of rows) {
    monthSet.add(row.period_start)
    let a = map.get(row.asin)
    if (!a) {
      a = {
        asin: row.asin, title: null,
        earningsCents: null, revenueCents: null, clicks: null, orders: null,
        months: {}, streams: [], scopes: [],
        e: adder(), r: adder(), c: adder(), o: adder(),
      }
      map.set(row.asin, a)
    }
    // Amazon repeats the title on every row; keep the longest non-empty one,
    // which is the least truncated.
    const t = (row.product_title || '').trim()
    if (t && (!a.title || t.length > a.title.length)) a.title = t
    a.e.add(row.earnings_cents); a.r.add(row.revenue_cents)
    a.c.add(row.clicks); a.o.add(row.orders)
    if (row.earnings_cents != null) a.months[row.period_start] = (a.months[row.period_start] ?? 0) + row.earnings_cents
    if (!a.streams.includes(row.stream)) a.streams.push(row.stream)
    if (row.store_scope && !a.scopes.includes(row.store_scope)) a.scopes.push(row.store_scope)
  }

  const months = Array.from(monthSet).sort()
  // Drop the running month from trend maths. It is partial, and comparing a
  // partial month to a whole one manufactures a decline in everything.
  const now = new Date()
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const settled = months.filter(m => m !== currentMonth)
  const recent = settled[settled.length - 1] ?? null
  const prior = settled[settled.length - 2] ?? null

  // Which products the creator already has content for. This is the half of the
  // answer Amazon can't give: a product earning well with no video behind it is
  // the clearest next thing to make.
  const asins = Array.from(map.keys())
  const videoCount = new Map<string, number>()
  const lastVideo = new Map<string, string>()
  // Chunked: a few hundred ids in one PostgREST `in` overflows the URL and the
  // whole query fails silently.
  for (let i = 0; i < asins.length; i += 100) {
    const chunk = asins.slice(i, i + 100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vids } = await (supabase as any)
      .from('youtube_videos')
      .select('asin,published_at')
      .eq('user_id', user.id)
      .in('asin', chunk)
    for (const v of (vids ?? []) as { asin: string | null; published_at: string | null }[]) {
      if (!v.asin) continue
      videoCount.set(v.asin, (videoCount.get(v.asin) ?? 0) + 1)
      const prev = lastVideo.get(v.asin)
      if (v.published_at && (!prev || v.published_at > prev)) lastVideo.set(v.asin, v.published_at)
    }
  }

  const products = Array.from(map.values()).map(a => {
    const recentCents = recent != null ? (a.months[recent] ?? null) : null
    const priorCents = prior != null ? (a.months[prior] ?? null) : null
    // Both sides or no arrow. A product that only appeared last month has no
    // direction yet, and pretending otherwise is the whole failure mode here.
    const deltaCents = recentCents != null && priorCents != null ? recentCents - priorCents : null
    const deltaPct = deltaCents != null && priorCents ? (deltaCents / priorCents) * 100 : null
    return {
      asin: a.asin,
      title: a.title,
      earningsCents: a.e.value,
      revenueCents: a.r.value,
      clicks: a.c.value,
      orders: a.o.value,
      months: a.months,
      streams: a.streams,
      scopes: a.scopes,
      recentCents, priorCents, deltaCents, deltaPct,
      videoCount: videoCount.get(a.asin) ?? 0,
      lastVideoAt: lastVideo.get(a.asin) ?? null,
    }
  }).sort((x, y) => (y.earningsCents ?? 0) - (x.earningsCents ?? 0))

  // How much of the monthly totals this breakdown actually explains. Amazon's own
  // page warns that low-volume rows are hidden and that the parts need not sum to
  // the whole, so this is stated rather than hidden: it tells the creator how
  // complete the product view is before they act on it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: periodData } = await (supabase as any)
    .from('amazon_earnings_periods')
    .select('period_start,earnings_cents')
    .eq('user_id', user.id)
  const periodTotal = adder()
  for (const p of (periodData ?? []) as { period_start: string; earnings_cents: number | null }[]) {
    if (monthSet.has(p.period_start)) periodTotal.add(p.earnings_cents)
  }
  const productTotal = adder()
  for (const p of products) productTotal.add(p.earningsCents)

  return NextResponse.json({
    ok: true,
    synced: true,
    months,
    recentMonth: recent,
    priorMonth: prior,
    products,
    coverage: {
      productCents: productTotal.value,
      periodCents: periodTotal.value,
    },
  })
}
