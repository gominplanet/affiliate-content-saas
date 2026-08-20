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
  commission?: number | null   // dollars (Total Earnings)
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

    const body = await request.json().catch(() => ({})) as { earnings?: EarningRow[] }
    const earnings = Array.isArray(body.earnings) ? body.earnings : []
    if (earnings.length === 0) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

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
        if (periodType !== 'weekly' && periodType !== 'monthly') return null
        if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) return null
        const units = toInt(e.units)
        const revenue_cents = toCents(e.revenue)
        const commission_cents = toCents(e.commission)
        const clicks = toInt(e.clicks)
        // Need at least one real metric, else it's noise.
        if (units == null && revenue_cents == null && commission_cents == null) return null
        const title = (e.productTitle ?? '').toString().trim().slice(0, 300)
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
          source: 'scout',
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
