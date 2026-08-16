// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/pin — publish (or schedule) a Pinterest Pin from an MVP Art
// Director thumbnail + a product link. Points the Pin straight at the creator's
// geni.us affiliate link (not a WordPress post) — the Amazon Influencer flow.
//
// Body: { imageUrl, productUrl?, asin?, productTitle?, boardId?, title?, description?, scheduledAt? }
//   imageUrl   — required, the thumbnail to pin (fal-hosted URL from the generator)
//   productUrl / asin — the product to link to (affiliate)
//   title / description — optional; blank → the AI writes them
//   scheduledAt — optional ISO time; when set, the pin is queued instead of posted now
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { publishAmazonPin, type PinIntegration } from '@/lib/amazon-pin-publish'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    imageUrl?: string; productUrl?: string; asin?: string; productTitle?: string
    boardId?: string; title?: string; description?: string; scheduledAt?: string
  }
  if (!body.imageUrl) return NextResponse.json({ error: 'A thumbnail image is required. Generate one first.' }, { status: 400 })

  const { data: rawInt } = await supabase
    .from('integrations')
    .select('tier,user_id,pinterest_access_token,pinterest_board_id,pinterest_pin_target,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intRow = decryptIntegrationRow(rawInt as any) as (PinIntegration & { tier?: string }) | null
  const tier = (intRow?.tier as Tier) ?? 'trial'

  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json({ error: 'Pinterest posting is on the Amazon, Studio and Pro plans.' }, { status: 403 })
  }
  if (!intRow?.pinterest_access_token) {
    return NextResponse.json({ error: 'Connect your Pinterest account first (Set up → Connect Socials).', needsConnect: true }, { status: 409 })
  }

  // ── Schedule for later ────────────────────────────────────────────────────
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
        user_id: user.id, platform: 'pinterest', image_url: body.imageUrl,
        asin: (body.asin || '').trim().toUpperCase() || null, product_url: (body.productUrl || '').trim() || null,
        product_title: (body.productTitle || '').trim() || null, board_id: (body.boardId || '').trim() || null,
        title: (body.title || '').trim() || null, description: (body.description || '').trim() || null,
        scheduled_at: at.toISOString(),
      })
      .select('id,scheduled_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, scheduled: true, id: data.id, scheduledAt: data.scheduled_at })
  }

  // ── Publish now ───────────────────────────────────────────────────────────
  try {
    const res = await publishAmazonPin({
      userId: user.id, tier, intRow,
      imageUrl: body.imageUrl, asin: body.asin, productUrl: body.productUrl, productTitle: body.productTitle,
      boardId: body.boardId, title: body.title, description: body.description,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest pin failed' }, { status: 500 })
  }
}
