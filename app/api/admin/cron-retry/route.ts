/**
 * POST /api/admin/cron-retry
 *
 * Flip a stuck or failed scheduled_posts row back to status='pending' so
 * the next cron tick picks it up. Admin-only.
 *
 * Body: { id: string }
 *
 * Side effects:
 *   - status → 'pending'
 *   - claimed_at → null
 *   - error_message preserved (audit history)
 *   - attempts NOT reset (so retry loops stay capped if we add a cap later)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (tierRow?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { id } = await request.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('scheduled_posts')
    .update({ status: 'pending', claimed_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['processing', 'failed'])
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Row not found, or already pending/completed' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
