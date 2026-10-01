// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/asin-families, every 30 minutes.
//
// Looks up the colour and size family (lib/asin-family) of products creators
// sold in the last 90 days, best sellers first, so sold-campaign matching has
// them before anyone opens Earnings. It only spends Keepa tokens above a floor
// the rest of MVP needs, and says what it did and why it stopped.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { familiesFor } from '@/lib/asin-family'
import { fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PER_RUN = 500
const MIN_TOKENS = 1500

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) return NextResponse.json({ ok: false, error: 'no Keepa key on the server' }, { status: 500 })
  const tokens = await fetchKeepaTokenStatus()
  if (tokens.tokensLeft != null && tokens.tokensLeft < MIN_TOKENS) {
    return NextResponse.json({ ok: true, skipped: `Keepa has ${tokens.tokensLeft} tokens; waiting for ${MIN_TOKENS}` })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const earned = new Map<string, number>()
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin.from('amazon_earnings_products')
      .select('asin, earnings_cents').gte('period_start', since).gt('orders', 0)
      .range(from, from + 999)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    for (const r of (data ?? []) as Array<{ asin: string; earnings_cents: number | null }>) {
      const a = String(r.asin || '').toUpperCase()
      earned.set(a, (earned.get(a) ?? 0) + (Number(r.earnings_cents) || 0))
    }
    if (!data || data.length < 1000) break
  }
  const asins = [...earned.keys()].sort((x, y) => earned.get(y)! - earned.get(x)!)
  const { report } = await familiesFor(admin, asins, { maxLookups: PER_RUN })
  return NextResponse.json({ ok: !report.error || report.lookedUp > 0, soldProducts: asins.length, ...report }, { status: report.error && report.lookedUp === 0 && report.known < report.asked ? 500 : 200 })
}
