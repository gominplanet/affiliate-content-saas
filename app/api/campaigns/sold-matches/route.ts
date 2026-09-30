// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/campaigns/sold-matches — Creator Connections campaigns for products
// the creator already sells (lib/sold-campaigns).
//
// GET                               the matches, best earner first, and
//                                   whether MVP accepts new ones daily
// POST { campaignId, asin, brand? } record one SCOUT accepted
// POST { auto: boolean }            turn the daily accepting on or off
// POST { autoRan: true }            the daily run finished today
//
// LABS (lib/labs-preview sold_campaigns): admin and Pro.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { soldCampaignMatches } from '@/lib/sold-campaigns'
import { createAdminClient } from '@/lib/supabase/admin'

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
  const r = await soldCampaignMatches(g.supabase, g.ownerId, { days, familySb: createAdminClient() })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: s } = await (g.supabase as any).from('integrations').select('sold_campaigns_auto, sold_campaigns_auto_at').eq('user_id', g.ownerId).maybeSingle()
  // Null is on: only an explicit off stops it. A database without migration
  // 391 has neither column, and reads as on with no run yet.
  return NextResponse.json({ ok: true, days, ...r, auto: s?.sold_campaigns_auto !== false, autoAt: s?.sold_campaigns_auto_at ?? null })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => ({})) as { campaignId?: string; asin?: string; brand?: string; auto?: boolean; autoRan?: boolean }
  if (typeof body.auto === 'boolean' || body.autoRan === true) {
    const patch = typeof body.auto === 'boolean' ? { sold_campaigns_auto: body.auto } : { sold_campaigns_auto_at: new Date().toISOString() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (createAdminClient() as any).from('integrations').update(patch).eq('user_id', g.ownerId)
    if (error) return NextResponse.json({ ok: false, error: /sold_campaigns_auto/.test(error.message) ? 'Migration 391 has not been run yet.' : error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
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
