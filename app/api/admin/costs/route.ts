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

    const [{ data: rows, error }, { data: posts }, { data: paidUsers }] = await Promise.all([
      sb.from('ai_usage')
        .select('tier,feature,model,input_tokens,output_tokens,web_searches,images,user_id')
        .gte('created_at', since)
        .limit(100000),
      // NET-NEW post volume in the same window — drives cost-per-post per tier.
      // Count by created_at, NOT published_at: published_at gets bumped on every
      // re-publish / update (rewrites, image refresh, schedule cascade, brand
      // re-sync), which massively over-counted "posts" (e.g. 299 vs 56 actual
      // generations) and made cost-per-post look artificially cheap. created_at
      // is immutable, so this is the true count of posts generated this window.
      sb.from('blog_posts')
        .select('user_id,created_at')
        .gte('created_at', since)
        .limit(100000),
      // ALL users + their tier — used to map each post's owner to a tier
      // (so we can attribute posts AND exclude admin-owned posts) and to count
      // paying users per tier for margin.
      sb.from('integrations')
        .select('user_id,tier')
        .limit(100000),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Map every user → their current tier (so we can attribute + filter posts).
    const userToTier: Record<string, string> = {}
    for (const u of (paidUsers ?? [])) {
      if (u.user_id && u.tier) userToTier[u.user_id as string] = u.tier as string
    }

    const byTier: Record<string, { cost: number; calls: number; users: Set<string> }> = {}
    const byFeature: Record<string, { cost: number; calls: number }> = {}
    let total = 0
    let calls = 0
    for (const r of (rows ?? [])) {
      const t = r.tier || 'unknown'
      // Exclude-admin view: skip the founder's own testing rows entirely.
      if (excludeAdmin && t === 'admin') continue
      const c = costOf(r)
      total += c; calls++
      const f = r.feature || 'unknown'
      ;(byTier[t] ??= { cost: 0, calls: 0, users: new Set() })
      byTier[t].cost += c
      byTier[t].calls++
      if (r.user_id) byTier[t].users.add(r.user_id as string)
      ;(byFeature[f] ??= { cost: 0, calls: 0 })
      byFeature[f].cost += c; byFeature[f].calls++
    }

    // Count NEW posts per tier in the same window (excluding admin-owned when asked).
    const postsByTier: Record<string, number> = {}
    let totalPosts = 0
    for (const p of (posts ?? [])) {
      const t = userToTier[p.user_id as string] || 'other'
      if (excludeAdmin && t === 'admin') continue
      postsByTier[t] = (postsByTier[t] || 0) + 1
      totalPosts++
    }

    // Currently-paying user count per tier — denominator for margin. Only the
    // real paid tiers (the integrations query now returns all users).
    const payingByTier: Record<string, number> = {}
    for (const u of (paidUsers ?? [])) {
      const t = u.tier as string
      if (t !== 'creator' && t !== 'studio' && t !== 'pro') continue
      payingByTier[t] = (payingByTier[t] || 0) + 1
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
          activeUsers: v.users.size,
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
