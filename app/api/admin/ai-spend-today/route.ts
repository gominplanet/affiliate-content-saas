/**
 * GET /api/admin/ai-spend-today — admin-only, READ-ONLY.
 *
 * Fine-grained "why is my Anthropic bill spiking?" diagnostic. Unlike
 * /api/admin/costs (which groups by day → tier → feature), this slices the
 * CURRENT day's ai_usage telemetry by feature, by USER, by model, and by HOUR
 * so a runaway account or a burst at a specific time jumps out immediately.
 *
 * ?hours=N overrides the window (default: since 00:00 UTC today). ?minUsd=X
 * hides trivial users from the per-user list.
 *
 * Note on the numbers: costOf() prices cache-read/creation input tokens at the
 * FULL input rate, so a cache-heavy day reads HIGHER here than the real
 * Anthropic invoice (cache reads bill at ~10%). Treat totals as an upper bound
 * and use the SHAPE (which feature/user/hour dominates) to find the leak.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { costOf, type UsageRow } from '@/lib/ai-usage'
import { globalDailyCeilingUsd, globalDailySpendUsd } from '@/lib/ai-spend'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const hoursParam = Number(sp.get('hours'))
  const minUsd = Number(sp.get('minUsd')) || 0.02
  const now = new Date()
  const since = Number.isFinite(hoursParam) && hoursParam > 0
    ? new Date(Date.now() - hoursParam * 3600_000).toISOString()
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  // Raw rows for the window (need per-user + per-hour, which the rollup RPCs
  // don't provide). Capped — if we hit the cap that itself is a red flag.
  const CAP = 20000
  const { data, error } = await admin
    .from('ai_usage')
    .select('user_id, tier, feature, model, input_tokens, output_tokens, web_searches, images, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(CAP)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<UsageRow & { user_id: string | null; tier: string | null; feature: string | null; created_at: string }>

  const bump = (m: Map<string, { cost: number; calls: number }>, k: string, c: number) => {
    const g = m.get(k) ?? { cost: 0, calls: 0 }; g.cost += c; g.calls += 1; m.set(k, g)
  }
  const byFeature = new Map<string, { cost: number; calls: number }>()
  const byModel = new Map<string, { cost: number; calls: number }>()
  const byHour = new Map<string, { cost: number; calls: number }>()
  const byTier = new Map<string, { cost: number; calls: number }>()
  const byUser = new Map<string, { cost: number; calls: number; tier: string; features: Map<string, number> }>()
  let total = 0

  for (const r of rows) {
    const c = costOf(r)
    total += c
    bump(byFeature, r.feature || 'unknown', c)
    bump(byModel, r.model || 'unknown', c)
    bump(byHour, r.created_at.slice(0, 13) + ':00Z', c) // UTC hour bucket
    bump(byTier, r.tier || 'unknown', c)
    const uid = r.user_id || '(none)'
    const u = byUser.get(uid) ?? { cost: 0, calls: 0, tier: r.tier || 'unknown', features: new Map<string, number>() }
    u.cost += c; u.calls += 1
    u.features.set(r.feature || 'unknown', (u.features.get(r.feature || 'unknown') ?? 0) + c)
    byUser.set(uid, u)
  }

  const round = (n: number) => Math.round(n * 100) / 100
  const sortEntries = (m: Map<string, { cost: number; calls: number }>) =>
    [...m.entries()].map(([k, v]) => ({ key: k, cost: round(v.cost), calls: v.calls })).sort((a, b) => b.cost - a.cost)

  const users = [...byUser.entries()]
    .map(([uid, v]) => {
      const topFeature = [...v.features.entries()].sort((a, b) => b[1] - a[1])[0]
      return { userId: uid, tier: v.tier, cost: round(v.cost), calls: v.calls, topFeature: topFeature ? `${topFeature[0]} ($${round(topFeature[1])})` : null }
    })
    .filter(u => u.cost >= minUsd)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20)

  // Where is the money concentrated? Cheap heuristics for the hint.
  const feats = sortEntries(byFeature)
  const topUser = users[0]
  const adminShare = round((byTier.get('admin')?.cost ?? 0))
  let hint = 'Spread across features/users — no single runaway source.'
  if (rows.length === 0) hint = 'No AI usage recorded in this window.'
  else if (topUser && topUser.cost > total * 0.6) hint = `Concentrated on ONE account (${topUser.userId}, ${topUser.tier}) — ${Math.round(topUser.cost / total * 100)}% of spend, mostly ${topUser.topFeature}.`
  else if (adminShare > total * 0.6) hint = `Most spend is on ADMIN accounts ($${adminShare}) — i.e. your own testing/generation, which is EXEMPT from every spend cap.`
  else if (feats[0] && feats[0].cost > total * 0.6) hint = `Dominated by one feature: ${feats[0].key} ($${feats[0].cost}, ${feats[0].calls} calls). If that's a background job, suspect a retry/reset loop.`
  if (rows.length >= CAP) hint = `⚠ Hit the ${CAP}-row cap — there are MORE calls than shown (a volume spike in itself). ` + hint

  const ceiling = globalDailyCeilingUsd()
  const globalToday = await globalDailySpendUsd()

  return NextResponse.json({
    ok: true,
    windowSince: since,
    rowsCounted: rows.length,
    totalUsd: round(total),
    hint,
    globalDailyCeilingUsd: ceiling,        // null = the platform-wide backstop is OFF
    globalSpendTodayUsd: round(globalToday),
    note: 'costOf prices cached input at full rate → this is an UPPER BOUND vs the real Anthropic invoice. Admins are exempt from all spend caps.',
    byFeature: feats,
    byModel: sortEntries(byModel),
    byTier: sortEntries(byTier),
    byHourUtc: [...byHour.entries()].map(([k, v]) => ({ hour: k, cost: round(v.cost), calls: v.calls })).sort((a, b) => a.hour.localeCompare(b.hour)),
    topUsers: users,
  })
}
