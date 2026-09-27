// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/brand-recap/log — record a recap that was sent, or tried.
//
// ok is what happened, not what was meant: true only when Amazon confirmed the
// Creator Connections message, or when the creator pressed "I sent it" after
// copying or emailing it. A failed send is kept too, with the reason, so the
// history never shows a recap the brand did not get. Only an ok recap counts
// its links as sent, which is what "new since your last recap" reads.
//
// Body: { brandKey, brand, urls[], asins[], channel: 'cc'|'copy'|'email', ok,
//         groups?, campaignId?, error?, message? }

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { brandKey } from '@/lib/brand-normalize'
import { shareableUrl } from '@/lib/brand-content'

export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['cc', 'copy', 'email'])

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('brand_recap', intg?.tier)) return NextResponse.json({ error: 'Brand recap is still being tested.' }, { status: 403 })

  const b = await req.json().catch(() => ({})) as {
    brandKey?: string; brand?: string; urls?: unknown[]; asins?: unknown[]; channel?: string; ok?: boolean
    groups?: number; campaignId?: string; error?: string; message?: string
  }
  const key = brandKey(b.brandKey || b.brand)
  if (!key) return NextResponse.json({ error: 'Which brand?' }, { status: 400 })
  const channel = CHANNELS.has(String(b.channel)) ? String(b.channel) : null
  if (!channel) return NextResponse.json({ error: 'How was it sent?' }, { status: 400 })
  const urls = [...new Set((b.urls ?? []).map((u) => shareableUrl(String(u))).filter(Boolean) as string[])].slice(0, 500)
  const asins = [...new Set((b.asins ?? []).map((a) => String(a).toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 200)
  const ok = b.ok === true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('brand_recaps').insert({
    user_id: ownerId, brand_key: key, brand_name: String(b.brand || '').slice(0, 200) || null, urls, asins, channel, ok,
    groups_sent: Number.isFinite(b.groups) ? b.groups : null, campaign_id: b.campaignId ? String(b.campaignId).slice(0, 120) : null,
    error: ok ? null : String(b.error || '').slice(0, 500) || null, message: String(b.message || '').slice(0, 8000) || null,
  })
  if (error) {
    const missing = /brand_recaps/.test(error.message) && /exist|schema cache|find/i.test(error.message)
    return NextResponse.json({ logged: false, error: missing ? 'The recap log table is missing (migration 379), so this send was not recorded and its links will still show as new.' : error.message }, { status: missing ? 200 : 500 })
  }

  // A recap that reached the brand also goes on the brand's history (Brand
  // Hub) and on the campaigns it covers, like any other message to them.
  if (ok) {
    try {
      await admin.from('brand_messages').insert({ user_id: ownerId, brand_name: b.brand || key, direction: 'outbound', channel: channel === 'cc' ? 'cc' : 'recap', body: String(b.message || '').slice(0, 8000) })
    } catch { /* the recap log above is the record that matters */ }
    if (asins.length) {
      try {
        await admin.from('campaigns').update({ messaged_at: new Date().toISOString(), last_message: String(b.message || '').slice(0, 4000) }).eq('user_id', ownerId).in('asin', asins)
      } catch { /* best effort */ }
    }
  }
  return NextResponse.json({ logged: true })
}
