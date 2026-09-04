// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-earnings — the creator's synced Amazon earnings.
//
// Returns the monthly rows as stored plus a couple of roll-ups the UI would
// otherwise recompute. Deliberately returns rows rather than one number: the
// whole point of this feature is that Amazon shows different totals on different
// pages depending on which store is selected, so the split has to stay visible.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PeriodRow {
  period_start: string; stream: string; store_id: string; store_scope: string | null
  clicks: number | null; orders: number | null; quantity: number | null
  earnings_cents: number | null; revenue_cents: number | null; synced_at: string
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
    .from('amazon_earnings_periods')
    .select('period_start,stream,store_id,store_scope,clicks,orders,quantity,earnings_cents,revenue_cents,synced_at')
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
  if (from) q = q.gte('period_start', from)
  if (to) q = q.lte('period_start', to)

  const { data, error } = await q
  if (error) {
    // A missing table means the migration hasn't run. Say so plainly instead of
    // rendering an empty dashboard that reads as "you earned nothing".
    return NextResponse.json({ error: error.message, rows: [], synced: false }, { status: 200 })
  }

  const rows = (data ?? []) as PeriodRow[]
  // Never coerce a null to zero. "Amazon didn't report this" and "this earned
  // nothing" look identical once you do, and only one of them is true.
  const sum = (pick: (r: PeriodRow) => number | null, filter?: (r: PeriodRow) => boolean) => {
    let total = 0, seen = false
    for (const r of rows) {
      if (filter && !filter(r)) continue
      const v = pick(r)
      if (v == null) continue
      total += v; seen = true
    }
    return seen ? total : null
  }

  const byStream: Record<string, number | null> = {}
  for (const s of ['cc', 'epc', 'commissions', 'bounties']) {
    byStream[s] = sum(r => r.earnings_cents, r => r.stream === s)
  }

  return NextResponse.json({
    ok: true,
    synced: rows.length > 0,
    lastSyncedAt: rows.length ? rows.reduce((a, r) => (r.synced_at > a ? r.synced_at : a), rows[0].synced_at) : null,
    rows,
    totals: {
      earningsCents: sum(r => r.earnings_cents),
      revenueCents: sum(r => r.revenue_cents),
      clicks: sum(r => r.clicks),
      orders: sum(r => r.orders),
      onsiteCents: sum(r => r.earnings_cents, r => r.store_scope === 'onsite'),
      offsiteCents: sum(r => r.earnings_cents, r => r.store_scope === 'offsite'),
      byStream,
    },
  })
}
