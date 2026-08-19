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
    const sb = supabase as any
    const { error } = await sb
      .from('campaigns')
      .update({ messaged_at: new Date().toISOString(), ...(message ? { last_message: message } : {}) })
      .eq('user_id', ownerId)
      .eq('asin', asin)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Append to the per-brand message log so Brand Hub shows the full
    // back-and-forth (campaigns.last_message only keeps the latest). Best-effort.
    if (message) {
      try {
        const { data: camp } = await sb.from('campaigns')
          .select('brand_name,campaign_name,product_title').eq('user_id', ownerId).eq('asin', asin).maybeSingle()
        const brandName = (camp?.brand_name || camp?.campaign_name || camp?.product_title || '').trim() || null
        await sb.from('brand_messages').insert({
          user_id: ownerId, brand_name: brandName, direction: 'outbound', channel: 'cc', body: message,
        })
      } catch { /* log is best-effort */ }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
