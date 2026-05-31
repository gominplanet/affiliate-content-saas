/**
 * GET /api/admin/creator-campaigns/status
 *
 * Admin-only stats for the centralized catalog. Surfaces:
 *   - total row count
 *   - most-recent imported_at (so admin knows when they last refreshed)
 *   - row count with budget + slots remaining (the "actionable" subset
 *     users see by default)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const [
    { count: total },
    { count: actionable },
    { data: latest },
  ] = await Promise.all([
    sb.from('creator_connections_catalog')
      .select('id', { count: 'exact', head: true }),
    sb.from('creator_connections_catalog')
      .select('id', { count: 'exact', head: true })
      .eq('has_budget_and_slots', true),
    sb.from('creator_connections_catalog')
      .select('imported_at')
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    ok: true,
    total: total ?? 0,
    actionable: actionable ?? 0,
    most_recent_import: latest?.imported_at ?? null,
  })
}
