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

    // Cascade — cancelling a kind='blog_publish' parent row also cancels
    // every still-pending social child queued behind it. ON DELETE
    // CASCADE on parent_id would handle a hard delete, but we keep
    // the parent row for audit (it just changes status to 'cancelled'),
    // so the cascade has to be an explicit UPDATE. Best-effort —
    // failure here doesn't undo the parent cancel.
    let cascadedChildCount = 0
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: children } = await (supabase as any)
        .from('scheduled_posts')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('parent_id', id)
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .select('id')
      cascadedChildCount = (children ?? []).length
    } catch (e) {
      // Pre-migration-103 databases don't have a parent_id column —
      // swallow the column-doesn't-exist error so the route still works
      // for rows scheduled before the migration ran. Drop the try/catch
      // once the migration has landed everywhere.
      console.warn('[scheduled-cancel] cascade skipped:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, cascadedChildCount })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
