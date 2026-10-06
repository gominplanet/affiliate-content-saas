// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/youtube-quota?day=YYYY-MM-DD
//
// The shared YouTube quota on a Pacific day (today by default): what was
// spent, by API method and by account, what MVP held back, and whether
// YouTube is refusing. Read from the call log (migration 397, lib/youtube-
// quota). When the log is missing that is said, never shown as zero.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { quotaToday, quotaDay, DAILY_QUOTA, RESERVE_AT } from '@/lib/youtube-quota'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if ((caller as { tier?: string } | null)?.tier !== 'admin') return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 })

  const q = new URL(request.url).searchParams.get('day')
  const day = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : quotaDay()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('youtube_quota_by', { p_day: day })
  if (error) {
    return NextResponse.json({
      ok: false,
      error: /youtube_quota_by|function|does not exist|schema cache/i.test(error.message)
        ? 'The YouTube call log is not set up yet (migration 397), so nothing has been recorded.'
        : error.message,
    }, { status: 200 })
  }
  type Row = { user_id: string | null; method: string; calls: number; units: number; failed: number }
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, calls: Number(r.calls), units: Number(r.units), failed: Number(r.failed) }))

  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
  const emails = new Map<string, string>()
  for (const id of ids) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(id)
      if (u?.user?.email) emails.set(id, u.user.email)
    } catch { /* shown as the id */ }
  }

  const byMethod = new Map<string, { calls: number; units: number; failed: number }>()
  const byUser = new Map<string, { email: string; calls: number; units: number; top: Array<{ method: string; units: number }> }>()
  let held = 0, refused = 0
  for (const r of rows) {
    if (r.method.startsWith('held.')) { held += r.calls; continue }
    if (r.method === 'quota_refused') { refused += r.calls; continue }
    const m = byMethod.get(r.method) ?? { calls: 0, units: 0, failed: 0 }
    m.calls += r.calls; m.units += r.units; m.failed += r.failed
    byMethod.set(r.method, m)
    const key = r.user_id || 'unknown'
    const u = byUser.get(key) ?? { email: r.user_id ? (emails.get(r.user_id) || r.user_id) : 'Not linked to an account', calls: 0, units: 0, top: [] }
    u.calls += r.calls; u.units += r.units; u.top.push({ method: r.method, units: r.units })
    byUser.set(key, u)
  }
  const today = day === quotaDay() ? await quotaToday() : null
  return NextResponse.json({
    ok: true,
    day,
    quota: DAILY_QUOTA,
    reserveAt: Math.round(DAILY_QUOTA * RESERVE_AT),
    spent: [...byMethod.values()].reduce((n, m) => n + m.units, 0),
    held, refused,
    refusedAt: today?.refusedAt ?? null,
    msToReset: today?.msToReset ?? null,
    byMethod: [...byMethod.entries()].map(([method, m]) => ({ method, ...m })).sort((a, b) => b.units - a.units),
    byUser: [...byUser.values()].map((u) => ({ ...u, top: u.top.sort((a, b) => b.units - a.units).slice(0, 3) })).sort((a, b) => b.units - a.units),
  })
}
