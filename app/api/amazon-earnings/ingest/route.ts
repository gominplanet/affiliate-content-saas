// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon-earnings/ingest — receive one batch of earnings rows from
// SCOUT, which reads them by replaying the endpoints Amazon's own reporting
// pages call, inside the creator's logged-in session.
//
// Two kinds of row arrive here:
//   periods  — the figures behind the tiles (clicks, orders, earnings, revenue)
//              for one month, one stream, one store.
//   products — the per-ASIN breakdown behind those totals.
//
// Everything upserts on its natural key, so re-syncing a window replaces it
// rather than adding to it. That is deliberate: Amazon's own exports overlap,
// and a design that accumulates silently double counts.
//
// Money arrives as floats with artifacts (60.639999866485596) and is stored in
// CENTS, rounded here, so no float ever reaches a total.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STREAMS = new Set(['cc', 'epc', 'commissions', 'bounties'])
const PERIOD_TYPES = new Set(['month', 'day'])

interface PeriodRow {
  periodStart?: string; periodType?: string; stream?: string
  storeId?: string; storeScope?: string
  clicks?: number | null; orders?: number | null; quantity?: number | null
  earnings?: number | null; revenue?: number | null
}
interface ProductRow extends PeriodRow { asin?: string; productTitle?: string | null }

/** Dollars (possibly with float artifacts) → whole cents. Null stays null, so a
 *  metric Amazon didn't report is never stored as a zero the UI would read as
 *  "earned nothing". */
const cents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}
/** YYYY-MM-DD only. Anything else is dropped rather than guessed at. */
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null) as { periods?: PeriodRow[]; products?: ProductRow[] } | null
  if (!body) return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })

  const admin = createAdminClient()
  let savedPeriods = 0
  let savedProducts = 0
  const skipped: string[] = []

  // Shared shape for both tables. Returns null for a row we can't key, so a
  // malformed entry is dropped rather than written under a wrong key.
  const base = (r: PeriodRow) => {
    const periodType = PERIOD_TYPES.has(String(r.periodType)) ? String(r.periodType) : 'month'
    if (!isDate(r.periodStart)) { skipped.push('bad periodStart'); return null }
    if (!STREAMS.has(String(r.stream))) { skipped.push(`unknown stream ${r.stream}`); return null }
    const storeId = String(r.storeId || '').trim()
    if (!storeId) { skipped.push('missing storeId'); return null }
    return {
      user_id: user.id,
      period_start: r.periodStart,
      period_type: periodType,
      stream: String(r.stream),
      store_id: storeId,
      store_scope: r.storeScope === 'onsite' || r.storeScope === 'offsite' ? r.storeScope : null,
      clicks: int(r.clicks),
      orders: int(r.orders),
      earnings_cents: cents(r.earnings),
      revenue_cents: cents(r.revenue),
      synced_at: new Date().toISOString(),
    }
  }

  if (Array.isArray(body.periods) && body.periods.length > 0) {
    const rows = body.periods
      .map(r => { const b = base(r); return b ? { ...b, quantity: int(r.quantity) } : null })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (rows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('amazon_earnings_periods')
        .upsert(rows, { onConflict: 'user_id,period_start,period_type,stream,store_id' })
      if (error) return NextResponse.json({ error: `Could not save totals: ${error.message}` }, { status: 500 })
      savedPeriods = rows.length
    }
  }

  if (Array.isArray(body.products) && body.products.length > 0) {
    const rows = body.products
      .map(r => {
        const b = base(r)
        if (!b) return null
        const asin = String(r.asin || '').trim().toUpperCase()
        // A product row without an ASIN cannot be keyed or joined to content, and
        // Amazon does emit campaign-level rows with none. Dropped on purpose.
        if (!/^[A-Z0-9]{10}$/.test(asin)) { skipped.push('product row without an ASIN'); return null }
        return { ...b, asin, quantity: int(r.quantity), product_title: (r.productTitle || '').toString().slice(0, 300) || null }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (rows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('amazon_earnings_products')
        .upsert(rows, { onConflict: 'user_id,period_start,period_type,stream,store_id,asin' })
      if (error) return NextResponse.json({ error: `Could not save products: ${error.message}` }, { status: 500 })
      savedProducts = rows.length
    }
  }

  return NextResponse.json({
    ok: true,
    savedPeriods,
    savedProducts,
    // Surfaced rather than swallowed: a sync that quietly drops half its rows is
    // how a dashboard ends up confidently wrong.
    skipped: skipped.length,
    skippedReasons: Array.from(new Set(skipped)).slice(0, 5),
  })
}
