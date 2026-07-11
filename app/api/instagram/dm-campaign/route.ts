/**
 * Instagram auto-DM campaigns — the "upload a Reel → auto-DM its link" feature.
 *
 *  GET  ?preview=1&productName=&description=&keyword=  → generate a caption to
 *        show in the composer (no publish, no DB write).
 *  GET  (no preview)                                   → list the user's campaigns.
 *  POST { videoUrl, link, keyword, productName, description?, caption? }
 *        → compose the caption (if not supplied), publish the Reel, and store a
 *          campaign keyed by the resulting media id so that a comment of the
 *          trigger word on that Reel auto-DMs `link` (handled in lib/ig-dm.ts).
 *  DELETE ?id=<campaignId>                             → deactivate a campaign.
 *
 * Pro-gated (same gate as every other IG publish path). Goes LIVE for creators
 * once Meta approves the comment/message permissions; safe to ship now — the
 * publish itself only needs the content-publishing permission MVP already has.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'
import { publishMedia, refreshLongLivedToken, subscribeToComments } from '@/services/instagram'
import { generateDmCampaignCaption } from '@/lib/direct-caption'

export const maxDuration = 300

const DEFAULT_KEYWORD = 'LINK'

function cleanKeyword(raw: unknown): string {
  // Single word, no spaces — a multi-word trigger is fragile to match. Cap length.
  return String(raw || '').trim().split(/\s+/)[0].slice(0, 30) || DEFAULT_KEYWORD
}

function isHttps(u: unknown): u is string {
  return typeof u === 'string' && /^https:\/\//i.test(u)
}
function isHttp(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u)
}

// ── GET: caption preview OR campaign list ────────────────────────────────────
export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { searchParams } = new URL(request.url)

  if (searchParams.get('preview')) {
    const productName = (searchParams.get('productName') || '').trim().slice(0, 200)
    const description = (searchParams.get('description') || '').trim().slice(0, 800)
    const keyword = cleanKeyword(searchParams.get('keyword'))
    if (!productName) return NextResponse.json({ error: 'Add a product name first.' }, { status: 400 })

    const [{ data: brand }, { data: integ }] = await Promise.all([
      sb.from('brand_profiles').select('niches,words_to_avoid,affiliate_disclaimer').eq('user_id', user.id).maybeSingle(),
      sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle(),
    ])
    const tier: Tier = normalizeTier(integ?.tier)
    const result = await generateDmCampaignCaption({
      productName,
      description,
      keyword,
      niches: Array.isArray(brand?.niches) ? (brand!.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand!.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
    }, { userId: user.id, tier })
    return NextResponse.json({ caption: result.caption })
  }

  const { data: campaigns } = await sb
    .from('ig_dm_campaigns')
    .select('id,ig_media_id,keyword,link,product_name,caption,status,error,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ campaigns: campaigns || [] })
}

// ── POST: publish the Reel + create the campaign ─────────────────────────────
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  let body: { videoUrl?: string; link?: string; keyword?: string; productName?: string; description?: string; caption?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const videoUrl = body.videoUrl
  const link = (body.link || '').trim()
  const keyword = cleanKeyword(body.keyword)
  const productName = (body.productName || '').trim().slice(0, 200)
  const description = (body.description || '').trim().slice(0, 800)

  if (!isHttps(videoUrl)) return NextResponse.json({ error: 'Upload a vertical video first.' }, { status: 400 })
  if (!isHttp(link)) return NextResponse.json({ error: 'Add the affiliate link to DM (must start with http).' }, { status: 400 })
  if (!productName) return NextResponse.json({ error: 'Add a product name.' }, { status: 400 })

  // ── Tier gate + token ──────────────────────────────────────────────────────
  const { data: integ } = await sb
    .from('integrations')
    .select('tier,instagram_user_id,instagram_access_token,instagram_token_expiry')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier: Tier = normalizeTier(integ?.tier)
  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.json({ error: 'Instagram posting is a Pro feature.', tierRequired: 'pro' }, { status: 403 })
  }
  let accessToken = integ?.instagram_access_token as string | undefined
  const igUserId = integ?.instagram_user_id as string | undefined
  if (!accessToken || !igUserId) {
    return NextResponse.json({ error: "Instagram isn't connected. Connect it in Integrations first.", reconnectRequired: true }, { status: 412 })
  }
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (expiry && Date.now() > expiry - 24 * 60 * 60 * 1000) {
    try {
      const refreshed = await refreshLongLivedToken(accessToken)
      accessToken = refreshed.accessToken
      await sb.from('integrations').update({ instagram_access_token: accessToken, instagram_token_expiry: refreshed.expiresAt }).eq('user_id', user.id)
    } catch { /* fall through with the current token */ }
  }

  // ── Caption: use the previewed one if provided, else compose fresh ──────────
  let caption = (body.caption || '').trim().slice(0, 2200)
  if (!caption) {
    const { data: brand } = await sb
      .from('brand_profiles').select('niches,words_to_avoid,affiliate_disclaimer').eq('user_id', user.id).maybeSingle()
    const result = await generateDmCampaignCaption({
      productName,
      description,
      keyword,
      niches: Array.isArray(brand?.niches) ? (brand.niches as string[]) : [],
      wordsToAvoid: Array.isArray(brand?.words_to_avoid) ? (brand.words_to_avoid as string[]) : [],
      affiliateDisclaimer: (brand?.affiliate_disclaimer as string) || '',
    }, { userId: user.id, tier })
    caption = result.caption
  }
  // Safety net: the whole funnel depends on viewers knowing to comment the word.
  // If an edited caption dropped it, append the CTA so the Reel still works.
  if (!caption.toLowerCase().includes(keyword.toLowerCase())) {
    caption = `${caption}\n\n💬 Comment "${keyword}" and I'll DM you the link 🔗`.slice(0, 2200)
  }

  // ── Publish the Reel ────────────────────────────────────────────────────────
  let mediaId: string
  try {
    mediaId = await publishMedia({
      userId: igUserId,
      accessToken: accessToken!,
      mediaType: 'REELS',
      videoUrl,
      caption,
      shareToFeed: true,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Instagram publish failed.' }, { status: 502 })
  }

  // Make sure this account receives comment webhooks (idempotent; also covers
  // accounts connected before auto-subscribe existed). Best-effort.
  try { await subscribeToComments({ igUserId, accessToken: accessToken! }) } catch { /* non-fatal */ }

  // ── Store the campaign, keyed by the published media id ─────────────────────
  const { data: created, error: insErr } = await sb
    .from('ig_dm_campaigns')
    .insert({
      user_id: user.id,
      ig_media_id: mediaId,
      keyword,
      link,
      product_name: productName,
      caption,
      video_url: videoUrl,
      status: 'active',
    })
    .select('id,ig_media_id,keyword,link,product_name,caption,status,created_at')
    .single()

  if (insErr) {
    // The Reel published but we couldn't record the campaign — surface it so the
    // user knows the DM won't fire and can retry / contact support.
    console.error('[dm-campaign] insert failed after publish', insErr)
    return NextResponse.json({
      ok: false,
      published: true,
      mediaId,
      error: 'The Reel posted, but saving the auto-DM link failed. Contact support with this media id.',
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, campaign: created, mediaId, caption })
}

// ── DELETE: deactivate a campaign ────────────────────────────────────────────
export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const id = (new URL(request.url).searchParams.get('id') || '').trim()
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  const { error } = await sb
    .from('ig_dm_campaigns')
    .update({ status: 'disabled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not update that campaign.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
