/**
 * GET /api/admin/generation-failures — admin-only, READ-ONLY.
 *
 * Diagnostic for the "[MVP ops] Generation failures spiking" alert. Dumps the
 * recent failed generation_jobs, grouped by error message, so you can see at a
 * glance whether it's one systemic cause (expired key → 401, model overload →
 * 529, spend ceiling → 403, WordPress/proxy down → connection errors) or a
 * scatter of isolated user errors. Also emits a best-guess hint.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const hours = Math.max(1, Math.min(72, Number(new URL(req.url).searchParams.get('hours')) || 6))
  const since = new Date(Date.now() - hours * 3600_000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('generation_jobs')
    .select('id, user_id, error, status, created_at, updated_at')
    .eq('status', 'failed')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{ id: string; user_id: string; error: string | null; updated_at: string }>

  // Group by a normalized error (strip ids/numbers so near-identical messages collapse).
  const norm = (e: string | null) =>
    (e || '(no error message)').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<id>').replace(/\d+/g, 'N').slice(0, 200)
  const byError = new Map<string, { count: number; sample: string; users: Set<string> }>()
  for (const r of rows) {
    const k = norm(r.error)
    const g = byError.get(k) ?? { count: 0, sample: r.error || '(no error message)', users: new Set<string>() }
    g.count++; g.users.add(r.user_id)
    byError.set(k, g)
  }
  const grouped = [...byError.values()]
    .map(g => ({ count: g.count, distinctUsers: g.users.size, sample: g.sample }))
    .sort((a, b) => b.count - a.count)

  // Heuristic hint from the dominant error.
  const top = (grouped[0]?.sample || '').toLowerCase()
  let hint = 'No obvious single cause — check the samples below.'
  if (rows.length === 0) hint = `No failed jobs in the last ${hours}h — it may have already cleared (or bump ?hours=).`
  else if (/401|unauthorized|invalid.*api.*key|authentication/.test(top)) hint = 'Looks like an EXPIRED/INVALID Anthropic API key (401). Rotate ANTHROPIC_API_KEY in Vercel.'
  else if (/429|rate.?limit/.test(top)) hint = 'Rate limited (429) — Anthropic account throttling. Back off or raise limits.'
  else if (/529|overloaded|503|502|500|internal server/.test(top)) hint = 'Model/API overload or 5xx — likely an Anthropic outage. Usually transient; jobs retry.'
  else if (/spend|ceiling|budget|over.*cap/.test(top)) hint = 'Hit the daily spend ceiling (GLOBAL_DAILY_SPEND_CEILING_USD). Raise/clear it if intended traffic.'
  else if (/wordpress|proxy|econn|timeout|fetch failed|wp-json|rest_/.test(top)) hint = 'WordPress/proxy errors — one site (or host WAF) may be down. Check distinctUsers: if 1, it is isolated to that creator.'

  return NextResponse.json({
    ok: true, hours, totalFailed: rows.length,
    hint,
    byError: grouped.slice(0, 12),
    recent: rows.slice(0, 15).map(r => ({ id: r.id, user_id: r.user_id, error: r.error, at: r.updated_at })),
  })
}
