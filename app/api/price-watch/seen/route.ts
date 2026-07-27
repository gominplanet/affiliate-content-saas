/**
 * POST /api/price-watch/seen — mark price alerts as read.
 * Body: { ids?: string[]; all?: boolean }. RLS keeps it to the user's own rows.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { ids?: string[]; all?: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('price_alerts').update({ seen: true }).eq('user_id', user.id).eq('seen', false)
  if (!body.all) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : []
    if (!ids.length) return NextResponse.json({ ok: true, updated: 0 })
    q = q.in('id', ids)
  }
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
