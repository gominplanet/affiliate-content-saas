/**
 * GET /api/admin/costs?days=30
 *
 * Admin-only. Aggregates real ai_usage telemetry into per-tier and
 * per-feature cost over the window, using lib/ai-usage pricing.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { costOf } from '@/lib/ai-usage'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const days = Math.min(365, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30))
    const since = new Date(Date.now() - days * 86400_000).toISOString()

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (admin as any)
      .from('ai_usage')
      .select('tier,feature,model,input_tokens,output_tokens,web_searches,images')
      .gte('created_at', since)
      .limit(100000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const byTier: Record<string, { cost: number; calls: number }> = {}
    const byFeature: Record<string, { cost: number; calls: number }> = {}
    let total = 0
    let calls = 0
    for (const r of (rows ?? [])) {
      const c = costOf(r)
      total += c; calls++
      const t = r.tier || 'unknown'
      const f = r.feature || 'unknown'
      ;(byTier[t] ??= { cost: 0, calls: 0 })
      byTier[t].cost += c; byTier[t].calls++
      ;(byFeature[f] ??= { cost: 0, calls: 0 })
      byFeature[f].cost += c; byFeature[f].calls++
    }

    const round = (n: number) => Math.round(n * 100) / 100
    return NextResponse.json({
      days,
      total: round(total),
      calls,
      byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, { cost: round(v.cost), calls: v.calls }])),
      byFeature: Object.fromEntries(Object.entries(byFeature).map(([k, v]) => [k, { cost: round(v.cost), calls: v.calls }])),
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
