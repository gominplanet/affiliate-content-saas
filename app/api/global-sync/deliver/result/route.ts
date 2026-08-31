// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/deliver/result — the SCOUT extension reports the outcome
// of a storefront upload so the UI can show delivery status per market.
//   body: { targetId, ok, detail?, deliveredUrl? }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { targetId?: string; ok?: boolean; detail?: string; deliveredUrl?: string }
  const targetId = (body.targetId || '').trim()
  if (!targetId) return NextResponse.json({ error: 'targetId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const patch = body.ok
    ? { state: 'delivered', delivered_at: new Date().toISOString(), detail: (body.detail || 'Uploaded to storefront').slice(0, 200), updated_at: new Date().toISOString() }
    : { state: 'failed', detail: (body.detail || 'Upload failed').slice(0, 200), updated_at: new Date().toISOString() }

  const { error } = await sb.from('global_sync_targets').update(patch).eq('id', targetId).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
