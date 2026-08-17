// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/social-caption — write an Instagram/Facebook caption for a
// product so the composer can pre-fill the box WHILE the design renders. Cheap
// Haiku call, disclosure + #ad #sponsored guaranteed.
//
// Body: { network: 'instagram'|'facebook', asin?, productUrl?, productTitle? } → { caption }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier, type Social } from '@/lib/tier'
import { writeSocialCaption } from '@/lib/amazon-social-publish'
import { spendGate } from '@/lib/ai-spend'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { network?: string; asin?: string; productUrl?: string; productTitle?: string }
  const network = (body.network === 'facebook' ? 'facebook' : 'instagram') as Social

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = ((intRow as { tier?: string } | null)?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, network)) return NextResponse.json({ error: 'Not on your plan.' }, { status: 403 })

  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  const caption = await writeSocialCaption({ userId: user.id, tier, productTitle: body.productTitle, productUrl: body.productUrl, asin: body.asin })
  return NextResponse.json({ ok: true, caption })
}
