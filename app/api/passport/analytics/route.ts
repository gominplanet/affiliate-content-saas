// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/passport/analytics?days=30 — the Passport Links dashboard data.
//
// Aggregates the creator's click log into: totals, clicks by country, by day (a
// trend), top products, and by source. Bounded fetch + in-JS aggregation keeps it
// simple; if click volume ever gets huge this moves to a SQL rollup, but the shape
// the dashboard consumes stays the same.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 20000

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any)
      .from('passport_link_clicks')
      .select('code, country, marketplace, source, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
    if (error) {
      // Table missing (migration 282 not run) → empty dashboard, not an error.
      return NextResponse.json({ ok: true, total: 0, byCountry: [], byDay: [], topProducts: [], bySource: [], days })
    }
    const clicks = (rows ?? []) as { code: string; country: string | null; source: string | null; created_at: string }[]

    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1)
    const countryM = new Map<string, number>()
    const sourceM = new Map<string, number>()
    const codeM = new Map<string, number>()
    const dayM = new Map<string, number>()
    for (const c of clicks) {
      bump(countryM, (c.country || 'US').toUpperCase())
      bump(sourceM, c.source || 'direct')
      bump(codeM, c.code)
      bump(dayM, c.created_at.slice(0, 10))
    }

    // Resolve top product codes → asin + label for display.
    const topCodes = [...codeM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    let labels: Record<string, { asin: string; label: string | null }> = {}
    if (topCodes.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: links } = await (supabase as any)
        .from('passport_links').select('code, asin, label').in('code', topCodes.map(([c]) => c))
      labels = Object.fromEntries(((links ?? []) as { code: string; asin: string; label: string | null }[]).map((l) => [l.code, { asin: l.asin, label: l.label }]))
    }

    // Dense day series (fill gaps with 0) so the trend renders evenly.
    const byDay: { date: string; count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      byDay.push({ date: d, count: dayM.get(d) || 0 })
    }

    return NextResponse.json({
      ok: true,
      total: clicks.length,
      days,
      byCountry: [...countryM.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
      bySource: [...sourceM.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      topProducts: topCodes.map(([code, count]) => ({ code, count, asin: labels[code]?.asin || null, label: labels[code]?.label || null })),
      byDay,
    })
  } catch {
    return NextResponse.json({ ok: true, total: 0, byCountry: [], byDay: [], topProducts: [], bySource: [], days })
  }
}
