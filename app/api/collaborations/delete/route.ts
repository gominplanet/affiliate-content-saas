/**
 * POST /api/collaborations/delete
 *
 * Bulk-delete the caller's own saved collaboration pitches. RLS
 * (collaborations_delete_own) already restricts deletes to the owner;
 * the explicit user_id filter is defense-in-depth.
 *
 * Body: { ids: string[] }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    // 2026-06-09 Phase 2 (VA): deleting collabs targets the owner's bucket.
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as { ids?: unknown }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No pitch ids provided' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await supabase
      .from('collaborations')
      .delete({ count: 'exact' })
      .eq('user_id', ownerId)
      .in('id', ids)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: count ?? ids.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
