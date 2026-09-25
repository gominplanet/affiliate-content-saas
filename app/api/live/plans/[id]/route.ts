// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET / DELETE /api/live/plans/[id] — one saved Amazon Live plan.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'

export const runtime = 'nodejs'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('amazon_live', intg?.tier)) return { error: NextResponse.json({ error: 'Not open yet.', code: 'tier_not_allowed' }, { status: 403 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, userId: user.id }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate()
  if (g.error) return g.error
  const { data } = await g.sb.from('live_plans').select('id,title,minutes,products,plan,updated_at').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 })
  return NextResponse.json({ plan: data.plan, id: data.id })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate()
  if (g.error) return g.error
  const { error } = await g.sb.from('live_plans').delete().eq('id', id).eq('user_id', g.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
