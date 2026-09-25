// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/live/plans — this creator's saved Amazon Live plans, newest first.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('amazon_live', intg?.tier)) return NextResponse.json({ error: 'Not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('live_plans')
    .select('id,title,minutes,products,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(30)
  if (error) return NextResponse.json({ plans: [], available: false })
  return NextResponse.json({ plans: data ?? [], available: true })
}
