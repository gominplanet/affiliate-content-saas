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
    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const sp = new URL(request.url).searchParams
    const days = Math.min(365, Math.max(1, parseInt(sp.get('days') || '30', 10) || 30))
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    // When set, drop the admin tier (the founder's own testing accounts) so the
    // numbers reflect REAL customer economics only.
    const excludeAdmin = sp.get('excludeAdmin') === '1'

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any

    // DB-side aggregation (migration 129) — replaces three .limit(100000) scans
    // + the in-JS loop. costOf() still applies pricing in TS from the grouped
    // token sums (cost is linear per model → exact parity, no SQL drift).
    const [rollupRes, activeRes, postsRes, payingRes] = await Promise.all([
      sb.rpc('admin_ai_cost_rollup', { p_since: since }),
      sb.rpc('admin_ai_active_users', { p_since: since }),
      sb.rpc('admin_posts_by_tier', { p_since: since }),
      sb.rpc('admin_paying_users'),
    ])
    if (rollupRes.error) return NextResponse.json({ error: rollupRes.error.message }, { status: 500 })

    const byTier: Record<string, { cost: number; calls: number }> = {}
    const byFeature: Record<string, { cost: number; calls: number }> = {}
    let total = 0
    let calls = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const g of ((rollupRes.data ?? []) as any[])) {
      const t = g.tier || 'unknown'
      // Exclude-admin view: skip the founder's own testing rows entirely.
      if (excludeAdmin && t === 'admin') continue
      // Coerce bigint sums (PostgREST may serialize int8 as string) before pricing.
      const c = costOf({
        model: g.model,
        input_tokens: Number(g.input_tokens) || 0,
        output_tokens: Number(g.output_tokens) || 0,
        web_searches: Number(g.web_searches) || 0,
        images: Number(g.images) || 0,
      })
      const n = Number(g.calls) || 0
      total += c; calls += n
      const f = g.feature || 'unknown'
      ;(byTier[t] ??= { cost: 0, calls: 0 }).cost += c
      byTier[t].calls += n
      ;(byFeature[f] ??= { cost: 0, calls: 0 }).cost += c
      byFeature[f].calls += n
    }

    // Distinct active users per tier in the window.
    const activeByTier: Record<string, number> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of ((activeRes.data ?? []) as any[])) {
      const t = a.tier || 'unknown'
      if (excludeAdmin && t === 'admin') continue
      activeByTier[t] = Number(a.users) || 0
    }

    // NET-NEW posts per tier in the window. Counted by created_at (immutable),
    // NOT published_at (bumped on every re-publish / image refresh / cascade /
    // brand re-sync), which over-counted posts and understated cost-per-post.
    const postsByTier: Record<string, number> = {}
    let totalPosts = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((postsRes.data ?? []) as any[])) {
      const t = p.tier || 'other'
      if (excludeAdmin && t === 'admin') continue
      const n = Number(p.posts) || 0
      postsByTier[t] = n
      totalPosts += n
    }

    // Currently-paying users per tier — denominator for margin (creator/studio/pro).
    const payingByTier: Record<string, number> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of ((payingRes.data ?? []) as any[])) {
      if (u.tier) payingByTier[u.tier as string] = Number(u.users) || 0
    }

    const round = (n: number) => Math.round(n * 100) / 100
    return NextResponse.json({
      days,
      total: round(total),
      calls,
      totalPosts,
      byTier: Object.fromEntries(
        Object.entries(byTier).map(([k, v]) => [k, {
          cost: round(v.cost),
          calls: v.calls,
          activeUsers: activeByTier[k] ?? 0,
        }]),
      ),
      byFeature: Object.fromEntries(
        Object.entries(byFeature).map(([k, v]) => [k, { cost: round(v.cost), calls: v.calls }]),
      ),
      postsByTier,
      payingByTier,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
