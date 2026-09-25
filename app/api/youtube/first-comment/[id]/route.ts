// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/youtube/first-comment/:id — act on one first comment. LABS.
//   { action: 'pin_result', pinned, error? }  what SCOUT saw when it pinned it
//   { action: 'cancel' }                      stop a comment that is still waiting

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
    return NextResponse.json({ error: 'Pinned first comments are in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { action?: string; pinned?: boolean; error?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('video_first_comments').select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That comment is not one of yours.' }, { status: 404 })
  if (body.action === 'pin_result') {
    const pinned = body.pinned === true
    await admin.from('video_first_comments').update({ pinned, pin_error: pinned ? null : String(body.error || 'SCOUT could not pin it.').slice(0, 300) }).eq('id', id)
    return NextResponse.json({ ok: true, pinned })
  }
  if (body.action === 'cancel') {
    if (row.state !== 'waiting') return NextResponse.json({ error: row.state === 'posted' ? 'It is already on the video. Delete it in YouTube Studio if you do not want it.' : 'It is not waiting.' }, { status: 409 })
    await admin.from('video_first_comments').update({ state: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, state: 'cancelled' })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
