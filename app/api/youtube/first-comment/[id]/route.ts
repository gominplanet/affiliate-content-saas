// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/youtube/first-comment/:id — act on one first comment. LABS.
//   { action: 'pin_result', pinned, error? }  what SCOUT saw when it pinned it
//   { action: 'cancel' }                      stop a comment that is still waiting
//   { action: 'dismiss' }                     clear one that could not be posted

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('first_comment', intg?.tier)) {
    return NextResponse.json({ error: 'Pinned comments are part of the Amazon and Pro plans.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { action?: string; pinned?: boolean; error?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('video_first_comments').select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That comment is not one of yours.' }, { status: 404 })
  if (body.action === 'pin_result') {
    const pinned = body.pinned === true
    const { error } = await admin.from('video_first_comments').update({ pinned, pin_error: pinned ? null : String(body.error || 'SCOUT could not pin it.').slice(0, 300) }).eq('id', id)
    if (error) return NextResponse.json({ error: 'Could not record the pin result.' }, { status: 500 })
    return NextResponse.json({ ok: true, pinned })
  }
  // DISMISS a comment that could not be posted: it stops being shown as a
  // problem, and nothing is posted. Try again is a new POST to the list route.
  if (body.action === 'dismiss') {
    if (row.state !== 'failed') return NextResponse.json({ error: 'Only a comment that could not be posted can be dismissed.' }, { status: 409 })
    await admin.from('video_first_comments').update({ state: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, state: 'cancelled' })
  }
  if (body.action === 'cancel') {
    if (row.state !== 'waiting') return NextResponse.json({ error: row.state === 'posted' ? 'It is already on the video. Delete it in YouTube Studio if you do not want it.' : 'It is not waiting.' }, { status: 409 })
    await admin.from('video_first_comments').update({ state: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, state: 'cancelled' })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
