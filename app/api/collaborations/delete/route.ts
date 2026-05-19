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

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { ids?: unknown }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No pitch ids provided' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase as any)
      .from('collaborations')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
      .in('id', ids)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: count ?? ids.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
