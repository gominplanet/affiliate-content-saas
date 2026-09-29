// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/campaigns/sold-matches — Creator Connections campaigns for products
// the creator already sells (lib/sold-campaigns).
//
// GET                          the matches, best earner first
// POST { campaignId, asin, brand? }   record one SCOUT accepted
//
// LABS, admin only while it is tested (lib/labs-preview sold_campaigns).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { soldCampaignMatches } from '@/lib/sold-campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('sold_campaigns', intg?.tier)) return { error: NextResponse.json({ error: 'This is in Labs.' }, { status: 403 }) }
  return { supabase, ownerId }
}

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 90))
  const r = await soldCampaignMatches(g.supabase, g.ownerId, { days })
  return NextResponse.json({ ok: true, days, ...r })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { campaignId?: string; asin?: string; brand?: string }
  const campaignId = String(body.campaignId || '').trim()
  if (!/^amzn1\.campaign\./.test(campaignId)) return NextResponse.json({ error: 'Which campaign?' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (g.supabase as any).from('cc_accepted_campaigns').upsert({
    user_id: g.ownerId, campaign_id: campaignId, asin: String(body.asin || '').toUpperCase() || null,
    brand_name: body.brand ? String(body.brand).slice(0, 200) : null, accepted_at: new Date().toISOString(), source: 'sold-match',
  }, { onConflict: 'user_id,campaign_id' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
