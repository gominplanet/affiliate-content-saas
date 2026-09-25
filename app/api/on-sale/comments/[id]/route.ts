// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/on-sale/comments/:id — act on one sale comment. LABS.
//   { action: 'take_sale_out' }  edit it to the after-sale version now
//   { action: 'pin_result', pinned, error? }  what SCOUT saw when it pinned it
//
// The pin result is SCOUT's own report of the page after it clicked, so the
// list shows "Pinned" only when the pinned badge was actually on screen.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { takeSaleOut } from '@/lib/sale-comments'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'On sale now is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { action?: string; pinned?: boolean; error?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('sale_comments')
    .select('id,user_id,youtube_video_id,channel_id,comment_id,lasting_text,state')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That comment is not one of yours.' }, { status: 404 })

  if (body.action === 'take_sale_out') {
    if (row.state === 'updated') return NextResponse.json({ ok: true, state: 'updated' })
    if (row.state === 'gone') return NextResponse.json({ error: 'The comment is no longer on the video, so there is nothing to edit.' }, { status: 409 })
    const r = await takeSaleOut(admin, row)
    if (r.state === 'updated') return NextResponse.json({ ok: true, state: 'updated' })
    if (r.state === 'gone') return NextResponse.json({ error: 'The comment is no longer on the video, so there is nothing to edit.', state: 'gone' }, { status: 409 })
    return NextResponse.json({ error: r.error, state: 'failed' }, { status: 502 })
  }
  if (body.action === 'pin_result') {
    const pinned = body.pinned === true
    await admin.from('sale_comments').update({
      pinned, pin_error: pinned ? null : String(body.error || 'SCOUT could not pin it.').slice(0, 300),
    }).eq('id', row.id)
    return NextResponse.json({ ok: true, pinned })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
