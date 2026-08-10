// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/ig — publish (or schedule) an Instagram feed post from an MVP
// Art Director design + a product. IG can't carry a clickable caption link, so
// the caption says "link in bio" and the product is dropped into the creator's
// Link-in-Bio shop grid (best-effort).
//
// Body: { imageUrl, productUrl?, asin?, productTitle?, caption?, scheduledAt? }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { publishToInstagram, type SocialIntegration } from '@/lib/amazon-social-publish'

export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    imageUrl?: string; productUrl?: string; asin?: string; productTitle?: string; caption?: string; scheduledAt?: string
  }
  if (!body.imageUrl) return NextResponse.json({ error: 'A design is required. Generate one first.' }, { status: 400 })

  const { data: rawInt } = await supabase
    .from('integrations')
    .select('tier,instagram_user_id,instagram_access_token,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', user.id).single()
  const intRow = decryptIntegrationRow(rawInt) as (SocialIntegration & { tier?: string }) | null
  const tier = (intRow?.tier as Tier) ?? 'trial'

  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.json({ error: 'Instagram posting is on the Amazon, Studio and Pro plans.' }, { status: 403 })
  }
  if (!intRow?.instagram_user_id || !intRow?.instagram_access_token) {
    return NextResponse.json({ error: 'Connect your Instagram account first.', needsConnect: true }, { status: 409 })
  }

  const when = (body.scheduledAt || '').trim()
  if (when) {
    const at = new Date(when)
    if (isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Pick a schedule time in the future.' }, { status: 400 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('amazon_scheduled_posts')
      .insert({
        user_id: user.id, platform: 'instagram', image_url: body.imageUrl,
        asin: (body.asin || '').trim().toUpperCase() || null, product_url: (body.productUrl || '').trim() || null,
        product_title: (body.productTitle || '').trim() || null, description: (body.caption || '').trim() || null,
        scheduled_at: at.toISOString(),
      })
      .select('id,scheduled_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, scheduled: true, id: data.id, scheduledAt: data.scheduled_at })
  }

  try {
    const res = await publishToInstagram({
      db: supabase, userId: user.id, tier, intRow,
      imageUrl: body.imageUrl, asin: body.asin, productUrl: body.productUrl, productTitle: body.productTitle, caption: body.caption,
    })
    return NextResponse.json({ ok: true, postUrl: res.url, id: res.id, caption: res.caption, linkUrl: res.linkUrl, geniuslinkNote: res.note })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Instagram post failed' }, { status: 500 })
  }
}
