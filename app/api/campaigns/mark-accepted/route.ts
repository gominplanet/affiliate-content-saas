/**
 * POST /api/campaigns/mark-accepted  { asin }
 *
 * Called from the /epc list after SCOUT confirms it clicked Accept on the
 * campaign's Amazon details page, so the row can show an "✓ Accepted" record.
 * Session-authed. Best-effort — a failure here never undoes the accept that
 * already happened on Amazon.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as { asin?: string }
    const asin = (body.asin || '').toString().trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('campaigns')
      .update({ accepted_at: new Date().toISOString() })
      .eq('user_id', ownerId)
      .eq('asin', asin)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
