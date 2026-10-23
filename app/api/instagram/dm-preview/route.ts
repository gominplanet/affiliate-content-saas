// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/instagram/dm-preview?link=
// The DM a Reel's Auto-DM sends for this link, word for word, before the Reel
// is posted (Seb, 2026-10-23: "showing the users the actual link, the actual
// affiliate link that will be sent out if someone says the word"). Built by
// the same code the webhook sends with (lib/ig-dm dmMessageFor), with the
// creator's own message from the Auto-DM page, so the preview cannot drift
// from the DM.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUseIgDm } from '@/lib/ig-dm-access'
import { dmMessageFor, PUBLIC_REPLY } from '@/lib/ig-dm'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUseIgDm(integ?.tier)) return NextResponse.json({ error: 'Instagram Auto-DM is not on your plan.' }, { status: 403 })

  const link = String(new URL(req.url).searchParams.get('link') || '').trim().slice(0, 1000)
  if (!/^https?:\/\//i.test(link)) return NextResponse.json({ error: 'Paste a link that starts with https://' }, { status: 400 })

  const { data: settings } = await sb.from('ig_dm_settings').select('*').eq('user_id', user.id).maybeSingle()
  const { message, store } = await dmMessageFor(user.id, settings?.message_template, link, false)
  return NextResponse.json({
    message,
    store,
    // MVP's reply under the comment, when the creator has it on.
    publicReply: settings?.reply_to_comment !== false ? PUBLIC_REPLY : null,
    ownMessage: !!String(settings?.message_template ?? '').trim(),
  })
}
