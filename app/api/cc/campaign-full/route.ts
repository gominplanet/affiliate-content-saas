// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/cc/campaign-full  { campaignId }
//
// SCOUT pressed Accept on a Creator Connections campaign and Amazon said it is
// full. The shared catalogue still showed spots from the last load, so every
// creator kept finding a campaign nobody can join. This sets its open spots to
// 0, and the "Has open spots" filter (on by default) hides it for everyone. The
// next catalogue load or live refresh sets the real count again, so a campaign
// that reopens comes back by itself.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { campaignId?: unknown }
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : ''
  if (!/^amzn1\.campaign\.[A-Za-z0-9._-]{4,120}$/.test(campaignId)) return NextResponse.json({ error: 'Which campaign?' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('cc_campaign_catalog')
    .update({ available_slot: 0 }).eq('campaign_id', campaignId).select('campaign_id')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // Say whether a row changed: a campaign MVP never had is not "removed".
  return NextResponse.json({ ok: true, marked: (data ?? []).length > 0 })
}
