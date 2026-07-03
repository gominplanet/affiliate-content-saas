/**
 * POST /api/campaigns/mark-messaged  { asin }
 *
 * Called by the Message-brand modal after SCOUT confirms the outreach was sent,
 * so the /epc list can show a "✓ Messaged" record for that product/campaign.
 * Session-authed (the modal runs on the MVP dashboard). Best-effort — a failure
 * here never blocks the message that already went out.
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

    const body = await request.json().catch(() => ({})) as { asin?: string; message?: string }
    const asin = (body.asin || '').toString().trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid ASIN is required' }, { status: 400 })
    }
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 6000) : ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('campaigns')
      .update({ messaged_at: new Date().toISOString(), ...(message ? { last_message: message } : {}) })
      .eq('user_id', ownerId)
      .eq('asin', asin)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
