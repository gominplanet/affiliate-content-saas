// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/storefront/ingest — revived Amazon Influencer earnings ingest.
//
// SESSION-authed (the signed-in MVP cookie), NOT the old cc_ingest_token that
// migration 230 removed. SCOUT's Linked-Product report scraper parses the
// creator's authenticated Amazon report and posts the per-ASIN rows here over
// the dashboard↔SCOUT session bridge; we verify the session, then upsert via
// the admin client (writes are service-role only — see migration 252 RLS).
//
// Amazon only renders products with a few shipments, so this captures the
// creator's PROVEN sellers. Idempotent per (asin, period_type, period_start).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CORS = {
  'Access-Control-Allow-Origin': 'https://www.amazon.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// GET — lightweight sync status for the SCOUT card: how many products SCOUT has
// landed and when it last synced. Session-authed (owner reads their own rows).
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { count } = await sb
      .from('storefront_earnings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    const { data: latest } = await sb
      .from('storefront_earnings')
      .select('synced_at')
      .eq('user_id', user.id)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return NextResponse.json({ products: count ?? 0, lastSyncedAt: latest?.synced_at ?? null })
  } catch {
    return NextResponse.json({ products: 0, lastSyncedAt: null })
  }
}

interface EarningRow {
  asin?: string
  productTitle?: string
  periodType?: string
  periodStart?: string
  periodEnd?: string
  units?: number | null
  revenue?: number | null      // dollars (Items Shipped Revenue)
  commission?: number | null   // dollars (Total Earnings / Commission Income)
  clicks?: number | null
  /** Which Amazon report the row came from: the regular Commissions table
   *  ('scout') or the Creator Connections table ('creator_connections'). They
   *  are separate income streams, so they're stored as distinct sources and the
   *  analytics view sums both per ASIN. Defaults to 'scout'. */
  source?: string
}

// Only these sources may be written by SCOUT. Anything else falls back to
// 'scout' so a bad tag can't fragment a product's history into junk buckets.
const ALLOWED_SOURCES = new Set(['scout', 'creator_connections'])

// Authoritative summary total for a period+source (from the report's summary
// tiles) — dollars in, cents stored.
interface TotalRow {
  periodType?: string
  periodStart?: string
  periodEnd?: string
  source?: string
  earnings?: number | null
  revenue?: number | null
  units?: number | null
  clicks?: number | null
}

const ASIN_RE = /^[A-Z0-9]{10}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const toCents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return isFinite(n) ? Math.round(n * 100) : null
}
const toInt = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return isFinite(n) ? Math.trunc(n) : null
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401, headers: CORS })

    const body = await request.json().catch(() => ({})) as { earnings?: EarningRow[]; totals?: TotalRow[] }
    const earnings = Array.isArray(body.earnings) ? body.earnings : []
    const totalsIn = Array.isArray(body.totals) ? body.totals : []

    // Authoritative summary totals (from the report's summary tiles) — the real
    // headline numbers, independent of the ~100-row product cap. Best-effort:
    // upsert whatever parsed; failures here never block the product rows.
    let totalsSaved = 0
    if (totalsIn.length) {
      const admin0 = createAdminClient()
      const trows = totalsIn
        .map((t) => {
          const periodType = String(t.periodType ?? '').trim().toLowerCase()
          const periodStart = String(t.periodStart ?? '').trim()
          const periodEnd = String(t.periodEnd ?? '').trim()
          const src = String(t.source ?? '').trim().toLowerCase()
          if (periodType !== 'weekly' && periodType !== 'monthly' && periodType !== 'ytd') return null
          if (!DATE_RE.test(periodStart)) return null
          const earnings_cents = toCents(t.earnings)
          const revenue_cents = toCents(t.revenue)
          if (earnings_cents == null && revenue_cents == null) return null
          return {
            user_id: user.id,
            period_type: periodType,
            period_start: periodStart,
            period_end: DATE_RE.test(periodEnd) ? periodEnd : null,
            source: ALLOWED_SOURCES.has(src) ? src : 'scout',
            earnings_cents,
            revenue_cents,
            units: toInt(t.units),
            clicks: toInt(t.clicks),
            synced_at: new Date().toISOString(),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      if (trows.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: tErr } = await (admin0 as any)
          .from('storefront_period_totals')
          .upsert(trows, { onConflict: 'user_id,period_type,period_start,source' })
        if (tErr) console.warn('[storefront/ingest] totals upsert failed:', tErr.message)
        else totalsSaved = trows.length

        // Daily snapshot of the headline totals per period type (summed across
        // sources) so the analytics page can show a real trend even for YTD,
        // which has no prior period. One row per (user, period_type, day); a
        // same-day re-sync overwrites it. Best-effort — never blocks the sync.
        try {
          const byType = new Map<string, { earnings_cents: number; revenue_cents: number; units: number; clicks: number }>()
          for (const r of trows) {
            const cur = byType.get(r.period_type) || { earnings_cents: 0, revenue_cents: 0, units: 0, clicks: 0 }
            cur.earnings_cents += r.earnings_cents ?? 0
            cur.revenue_cents += r.revenue_cents ?? 0
            cur.units += r.units ?? 0
            cur.clicks += r.clicks ?? 0
            byType.set(r.period_type, cur)
          }
          const takenOn = new Date().toISOString().slice(0, 10)
          const snaps = [...byType.entries()].map(([period_type, v]) => ({
            user_id: user.id, period_type, taken_on: takenOn,
            earnings_cents: v.earnings_cents, revenue_cents: v.revenue_cents,
            units: v.units, clicks: v.clicks,
          }))
          if (snaps.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin0 as any).from('storefront_snapshots')
              .upsert(snaps, { onConflict: 'user_id,period_type,taken_on' })
          }
        } catch { /* snapshots table absent (migration 273 not run) — skip */ }
      }
    }

    if (earnings.length === 0) return NextResponse.json({ ok: true, upserted: 0, totalsSaved }, { headers: CORS })

    // Validate + normalize. Skip anything without a clean ASIN, valid period
    // type, and an ISO date range — so a bad scrape degrades to fewer rows,
    // never corrupt data.
    const rows = earnings
      .map((e) => {
        const asin = String(e.asin ?? '').trim().toUpperCase()
        const periodType = String(e.periodType ?? '').trim().toLowerCase()
        const periodStart = String(e.periodStart ?? '').trim()
        const periodEnd = String(e.periodEnd ?? '').trim()
        if (!ASIN_RE.test(asin)) return null
        // 'ytd' = SCOUT read a whole-year on-screen view (the creator set "This
        // Year"); weekly/monthly are the shorter report ranges.
        if (periodType !== 'weekly' && periodType !== 'monthly' && periodType !== 'ytd') return null
        if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) return null
        const units = toInt(e.units)
        const revenue_cents = toCents(e.revenue)
        const commission_cents = toCents(e.commission)
        const clicks = toInt(e.clicks)
        // Need at least one real metric, else it's noise.
        if (units == null && revenue_cents == null && commission_cents == null) return null
        const title = (e.productTitle ?? '').toString().trim().slice(0, 300)
        const src = String(e.source ?? '').trim().toLowerCase()
        return {
          user_id: user.id,
          asin,
          product_title: title || null,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          units,
          revenue_cents,
          commission_cents,
          clicks,
          source: ALLOWED_SOURCES.has(src) ? src : 'scout',
          synced_at: new Date().toISOString(),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Historical report pages (a full month, or a wide custom range) can carry
      // far more rows than a current-week view — allow a big backfill batch.
      .slice(0, 2000)

    if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('storefront_earnings')
      // source joined the unique key in migration 268 (CSV import + CC). SCOUT
      // rows carry source='scout', so this still upserts one row per product per
      // period. Falls back to the pre-268 key if the migration isn't applied yet.
      .upsert(rows, { onConflict: 'user_id,asin,period_type,period_start,source' })
    if (error) {
      console.warn('[storefront/ingest] upsert failed:', error.message)
      return NextResponse.json({ error: 'Could not save earnings.' }, { status: 500, headers: CORS })
    }

    return NextResponse.json({ ok: true, upserted: rows.length }, { headers: CORS })
  } catch (e) {
    console.warn('[storefront/ingest] error:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Ingest failed.' }, { status: 500, headers: CORS })
  }
}
