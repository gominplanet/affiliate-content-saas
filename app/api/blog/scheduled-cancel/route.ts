/**
 * POST /api/blog/scheduled-cancel
 *
 * Marks a pending scheduled post as cancelled so the cron worker skips
 * it. No-op (with 409) if the row has already moved past pending.
 *
 * Body: { id: string }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await request.json() as { id?: string }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Only allow cancelling rows that are still pending — once they
    // move to processing/completed/failed/cancelled it's a no-op.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) {
      return NextResponse.json({ error: 'Already published or cancelled — nothing to do.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
