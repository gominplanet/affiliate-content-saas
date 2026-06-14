/**
 * POST /api/campaigns/refresh-image
 *
 * Re-applies the hero image to an ALREADY-PUBLISHED campaign post without
 * re-running the (expensive) Opus write. Used by the "Fix image" button on
 * live EPC rows to repair the "Get it now" CTA card — older campaign posts
 * shipped with the shared template's YouTube-thumbnail placeholder, which is a
 * broken image for video-less campaign posts.
 *
 * Flow: load the campaign + its live WP post id + current content → scrape the
 * product → build a 16:9 hero (product-photo fallback = no AI spend) → upload →
 * rewrite the CTA thumb to the hero (or strip it) → updatePost the SAME post
 * (no new post, no duplicate). Mirrors the generate route's publish auth chain:
 * decrypted creds + body-auth proxy self-heal so the write clears the host WAF.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchWpProxySecret } from '@/lib/wp-proxy'
import { maybeEncrypt } from '@/lib/secrets'
import { setCtaThumb, stripCtaThumb } from '@/lib/cta-thumb'
import { fetchAmazonProduct } from '@/services/amazon'
import { pickProductReferenceImage } from '@/lib/product-image'
import { buildCampaignHero } from '@/lib/hero-image'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const maxDuration = 120

function slugFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : null
  } catch { return null }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const campaignId = body.campaignId as string | undefined
  if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsCampaigns(tier)) {
    return NextResponse.json({ error: 'Creator Campaigns is a Pro feature.' }, { status: 403 })
  }
  const blocked = await spendGate(user.id, tier)
  if (blocked) return blocked

  // Load the campaign + its content (generated_content from migration 128 may
  // not exist on older rows; we prefer the live blog_posts.content anyway).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: campaign } = await (supabase as any)
    .from('campaigns')
    .select('id,asin,blog_post_id,wordpress_url,generated_content')
    .eq('id', campaignId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const asin = campaign.asin as string

  // Resolve the live WP post id + current post content (blog_posts wins; the
  // generated_content column is the fallback).
  let wpPostId: number | null = null
  let content: string | null = (campaign.generated_content as string | null) || null
  if (campaign.blog_post_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('wordpress_post_id,content')
      .eq('id', campaign.blog_post_id)
      .eq('user_id', user.id)
      .maybeSingle()
    wpPostId = (postRow?.wordpress_post_id as number | null) ?? null
    if (postRow?.content) content = postRow.content as string
  }

  // WP creds + body-auth proxy self-heal (same chain as the publish path).
  const wpCreds = await getWordPressCredentials(supabase, user.id)
  if (!wpCreds?.wordpress_url) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  let proxyToken = wpCreds.wordpress_api_token || undefined
  const liveSecret = await fetchWpProxySecret({
    siteUrl: wpCreds.wordpress_url,
    username: wpCreds.wordpress_username,
    appPassword: wpCreds.wordpress_app_password,
  })
  if (liveSecret && liveSecret !== wpCreds.wordpress_api_token) {
    proxyToken = liveSecret
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any
      await Promise.all([
        sb.from('wordpress_sites').update({ api_token: maybeEncrypt(liveSecret) }).eq('user_id', user.id).eq('url', wpCreds.wordpress_url),
        sb.from('integrations').update({ wordpress_api_token: maybeEncrypt(liveSecret) }).eq('user_id', user.id),
      ])
    } catch { /* non-fatal */ }
  }
  const wpService = createWordPressService(
    wpCreds.wordpress_url,
    wpCreds.wordpress_username,
    wpCreds.wordpress_app_password,
    proxyToken,
  )

  if (!wpPostId) {
    const slug = slugFromUrl(campaign.wordpress_url as string | null)
    if (slug) { try { wpPostId = await wpService.getPostIdBySlug(slug) } catch { /* fall through */ } }
  }
  if (!wpPostId) {
    return NextResponse.json({ error: "Couldn't find the published post to update." }, { status: 404 })
  }

  // Build the hero. No stored hero prompt on a re-publish, so this uses the
  // product-photo fallback (letterboxed to 16:9) — clean and zero AI spend.
  let heroMediaId: number | null = null
  let heroUrl: string | null = null
  try {
    const product = await fetchAmazonProduct(asin)
    if (product) {
      const cleanProductImage = (await pickProductReferenceImage(product.images, product.title, { userId: user.id, tier })) || product.imageUrl
      const hero = await buildCampaignHero({ heroPrompt: undefined, productImageUrl: cleanProductImage, ctx: { userId: user.id, tier } })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, `${asin}-hero.jpg`, hero.mime)
        heroMediaId = media.id
        heroUrl = media.source_url || null
      }
    }
  } catch { /* fall through to the no-hero error below */ }

  if (!heroMediaId && !heroUrl) {
    return NextResponse.json({ error: "Couldn't build the product image (Amazon fetch or image step failed). Try again in a moment." }, { status: 502 })
  }

  // Rewrite the CTA thumb to the hero (or strip the broken placeholder).
  const patched = content ? (heroUrl ? setCtaThumb(content, heroUrl) : stripCtaThumb(content)) : null
  const contentChanged = !!patched && patched !== content

  try {
    await wpService.updatePost(wpPostId, {
      ...(heroMediaId ? { featured_media: heroMediaId } : {}),
      ...(contentChanged ? { content: patched! } : {}),
    })
  } catch (err) {
    return NextResponse.json({ error: `WordPress update failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }

  // Keep our copies in sync.
  if (contentChanged) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any
      if (campaign.blog_post_id) await sb.from('blog_posts').update({ content: patched }).eq('id', campaign.blog_post_id).eq('user_id', user.id)
      await sb.from('campaigns').update({ generated_content: patched, hero_kind: 'product', updated_at: new Date().toISOString() }).eq('id', campaignId)
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, heroUrl, updatedContent: contentChanged })
}
