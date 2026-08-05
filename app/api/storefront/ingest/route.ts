/**
 * POST /api/storefront/ingest
 *
 * Storefront Stats v2. The SCOUT extension reads the creator's authenticated
 * Amazon Influencer earnings/reports pages and posts per-ASIN totals here.
 * Bearer-token authed (integrations.cc_ingest_token — same token as the CC
 * ingest, since it's the same extension on amazon.com with no dashboard cookie);
 * RLS bypassed via the service-role client. Pro-tier only.
 *
 * Body: {
 *   earnings: [{
 *     asin, periodType ('weekly'|'monthly'), periodStart 'YYYY-MM-DD',
 *     periodEnd 'YYYY-MM-DD', units?, orderedItems?,
 *     revenue? (dollars), commission? (dollars), clicks?
 *   }]
 * }
 * Idempotent: upserts on (user_id, asin, period_type, period_start).
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CC-Token',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

interface IncomingEarning {
  asin?: string
  periodType?: string
  periodStart?: string
  periodEnd?: string
  units?: number
  orderedItems?: number
  revenue?: number      // dollars
  commission?: number   // dollars
  clicks?: number
}

const toCents = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? Math.round(n * 100) : null
}
const toInt = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? Math.trunc(n) : null
}
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (request.headers.get('x-cc-token') || '').trim()
    if (!token) return NextResponse.json({ error: 'Missing ingest token' }, { status: 401, headers: CORS })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await admin
      .from('integrations')
      .select('user_id,tier')
      .eq('cc_ingest_token', token)
      .single()
    if (!intRow?.user_id) return NextResponse.json({ error: 'Invalid ingest token' }, { status: 401, headers: CORS })

    const userId = intRow.user_id as string
    const tier = (intRow.tier as Tier) ?? 'trial'
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json({ error: 'Storefront Stats is a Pro feature.' }, { status: 403, headers: CORS })
    }

    const body = await request.json().catch(() => null) as { earnings?: IncomingEarning[] } | null
    const list = Array.isArray(body?.earnings) ? body!.earnings : []
    if (list.length === 0) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

    // Build valid rows. Skip anything without an ASIN + a valid period.
    const rows = list.map((e) => {
      const asin = (e.asin || '').trim().toUpperCase()
      const periodType = e.periodType === 'monthly' ? 'monthly' : e.periodType === 'weekly' ? 'weekly' : null
      if (!asin || !periodType || !isDate(e.periodStart) || !isDate(e.periodEnd)) return null
      return {
        user_id: userId,
        asin,
        period_type: periodType,
        period_start: e.periodStart,
        period_end: e.periodEnd,
        units: toInt(e.units),
        ordered_items: toInt(e.orderedItems),
        revenue_cents: toCents(e.revenue),
        commission_cents: toCents(e.commission),
        clicks: toInt(e.clicks),
        source: 'scout',
        synced_at: new Date().toISOString(),
      }
    }).filter(Boolean) as Record<string, unknown>[]

    if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 }, { headers: CORS })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('storefront_earnings')
      .upsert(rows, { onConflict: 'user_id,asin,period_type,period_start' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })

    // Stamp last-sync so the dashboard can show freshness.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('integrations').update({ storefront_synced_at: new Date().toISOString() }).eq('user_id', userId)

    return NextResponse.json({ ok: true, upserted: rows.length }, { headers: CORS })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: CORS })
  }
}
