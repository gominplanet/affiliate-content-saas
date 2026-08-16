// POST /api/heartbeat — stamp the signed-in creator's real "last seen" time.
// Called (throttled) by the dashboard shell so the admin Users list shows actual
// activity instead of auth.users.last_sign_in_at (which only moves on an explicit
// sign-in). Server-side throttle: only writes when the last stamp is >5 min old,
// so a chatty client can't hammer the DB.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const THROTTLE_MS = 5 * 60 * 1000

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: row } = await sb.from('integrations').select('last_seen_at').eq('user_id', user.id).maybeSingle()
    const last = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0
    if (Date.now() - last < THROTTLE_MS) return NextResponse.json({ ok: true, skipped: true })
    await sb.from('integrations').update({ last_seen_at: new Date().toISOString() }).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  } catch {
    // Never surface a heartbeat failure to the user — it's fire-and-forget.
    return NextResponse.json({ ok: false })
  }
}
