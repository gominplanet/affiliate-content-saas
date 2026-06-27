/**
 * POST /api/tools/title-audit/ignore  { postId, title?, undo? }
 *
 * Dismiss (or un-dismiss) a Title Check flag the creator is happy to keep.
 *   - default: upsert an ignore row { post_id, ignored_title } so future scans
 *     skip this post WHILE its title still matches what was dismissed.
 *   - { undo: true }: delete the ignore so it can surface again.
 *
 * Stored per authenticated user (migration 143, RLS auth.uid() = user_id).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { user } = auth

  const { postId, title, undo } = (await request.json().catch(() => ({}))) as {
    postId?: string
    title?: string
    undo?: boolean
  }
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 })

  try {
    if (undo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('title_audit_ignores')
        .delete()
        .eq('user_id', user.id)
        .eq('post_id', postId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, ignored: false })
    }

    const ignoredTitle = (title || '').trim()
    if (!ignoredTitle) return NextResponse.json({ error: 'title is required to ignore' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('title_audit_ignores')
      .upsert(
        { user_id: user.id, post_id: postId, ignored_title: ignoredTitle, created_at: new Date().toISOString() },
        { onConflict: 'user_id,post_id' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, ignored: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
