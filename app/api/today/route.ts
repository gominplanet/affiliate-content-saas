// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/today — the Pro dashboard's one ranked list of what needs the creator
// (lib/today-list.ts). Database reads only, so it is cheap on every visit.
//
// GET  { items, unread }   `unread` names any source that could not be read,
//                          so an empty list is never a silent failure.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canSeeNav } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'
import { gatherToday } from '@/lib/today-list'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intg?.tier)
  if (!canSeeNav('labs', tier)) return NextResponse.json({ error: 'Today is part of Pro.', upgrade: true }, { status: 403 })
  const report = await gatherToday(createAdminClient(), ownerId, tier)
  return NextResponse.json(report)
}
