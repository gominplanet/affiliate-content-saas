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
import { normalizeOwnership, hasHandsOn, tiktokProductFacts } from '@/lib/product-ownership'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { network?: string; asin?: string; productUrl?: string; productTitle?: string; tiktokProductId?: string }
  const network = (body.network === 'facebook' ? 'facebook' : 'instagram') as Social

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = ((intRow as { tier?: string } | null)?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, network)) return NextResponse.json({ error: 'Not on your plan.' }, { status: 403 })

  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  // A SAVED TIKTOK PRODUCT. Its facts were read off the product's own page when
  // it was added, and its ownership answer decides whether the caption may
  // speak from hands-on experience. Both come from the same helpers the blog
  // uses, so the two surfaces cannot say different things about one product.
  let facts: string[] | undefined
  let handsOn: boolean | undefined
  let productTitle = body.productTitle
  const tiktokProductId = (body.tiktokProductId || '').trim()
  if (tiktokProductId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tp } = await (supabase as any)
      .from('tiktok_products').select('*')
      .eq('user_id', user.id).eq('product_id', tiktokProductId).maybeSingle()
    if (!tp) return NextResponse.json({ error: 'That TikTok product is not in your saved products.' }, { status: 404 })
    productTitle = productTitle || (tp.title as string)
    facts = tiktokProductFacts(tp)
    handsOn = hasHandsOn(normalizeOwnership(tp.ownership as string | null))
  }

  const caption = await writeSocialCaption({
    userId: user.id, tier, productTitle, productUrl: body.productUrl, asin: body.asin, facts, handsOn,
  })
  return NextResponse.json({ ok: true, caption })
}
