// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/blog/brand-recap/[postId]?wpUrl=…
//
// Powers the "Share with brand" modal on the Blog Post Generator. Given a
// published post, returns every link MVP stored for it (product, blog,
// YouTube, socials), a best-guess brand name, and the recap message pre-filled
// from the creator's saved template (or the in-code default).
//
// Owner-scoped. Accepts the blog_posts UUID OR a WordPress post id (the
// "Published Posts" rows for video-less posts send the WP id) via
// resolveBlogPostId — same dual-resolution the social routes use.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import {
  buildRecapLinks, guessBrandName, fillRecapMessage,
  DEFAULT_RECAP_TEMPLATE, isAmazonUrl,
  type BrandRecapSettings, type RecapLink,
} from '@/lib/brand-recap'

export const dynamic = 'force-dynamic'

/** Server-side mirror of the Content page's deriveProductUrl — the first
 *  affiliate/product link in the video description, a stored product_url, or
 *  an ASIN-derived Amazon link. Returns null for non-product topics. */
function deriveProductUrl(video: Record<string, unknown> | null): string | null {
  if (!video) return null
  const desc = (video.description as string) || ''
  const title = (video.title as string) || ''
  const clean = (u: string) => u.replace(/[.,;:)\]>"']+$/, '')
  const patterns = [
    /https?:\/\/(?:www\.)?geni\.us\/[^\s)>\]"']+/i,
    /https?:\/\/(?:www\.)?amzn\.to\/[^\s)>\]"']+/i,
    /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:dp|gp\/product)\/[A-Z0-9]{10}[^\s)>\]"']*/i,
  ]
  for (const re of patterns) {
    const m = desc.match(re)
    if (m) return clean(m[0])
  }
  const stored = (video.product_url as string | null)?.trim()
  if (stored) return stored
  const asin =
    desc.toUpperCase().match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/)?.[1] ||
    title.toUpperCase().match(/\b(B0[A-Z0-9]{8})\b/)?.[1] ||
    desc.toUpperCase().match(/\b(B0[A-Z0-9]{8})\b/)?.[1] ||
    null
  return asin ? `https://www.amazon.com/dp/${asin}` : null
}

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    const { postId: rawId } = await params
    const wpUrl = new URL(request.url).searchParams.get('wpUrl')
    const id = await resolveBlogPostId(supabase, ownerId, rawId, wpUrl)
    if (!id) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('id, title, video_id, wordpress_url, tiktok_share_url, pinterest_pin_id, twitter_post_id, facebook_post_id, linkedin_post_id')
      .eq('user_id', ownerId)
      .eq('id', id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Linked video (if any) → YouTube link + product-link derivation source.
    let video: Record<string, unknown> | null = null
    if (post.video_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: v } = await (supabase as any)
        .from('youtube_videos')
        .select('youtube_video_id, title, description, product_url')
        .eq('id', post.video_id)
        .maybeSingle()
      video = v ?? null
    }
    const youtubeUrl = video?.youtube_video_id
      ? `https://www.youtube.com/watch?v=${video.youtube_video_id}`
      : null
    const productUrl = deriveProductUrl(video)

    // Brand profile → settings + sign-off defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await (supabase as any)
      .from('brand_profiles')
      .select('name, author_name, website_url, brand_recap_settings')
      .eq('user_id', ownerId)
      .maybeSingle()

    const saved = (brand?.brand_recap_settings ?? null) as Partial<BrandRecapSettings> | null
    const settings: BrandRecapSettings = {
      template: saved?.template || DEFAULT_RECAP_TEMPLATE,
      tone: saved?.tone || 'warm',
      senderName: saved?.senderName || (brand?.author_name as string) || (brand?.name as string) || '',
      siteUrl: saved?.siteUrl || (brand?.website_url as string) || '',
    }

    const links: RecapLink[] = buildRecapLinks({ post, youtubeUrl, productUrl })
    const productName = (video?.title as string) || (post.title as string) || ''
    const brandGuess = guessBrandName(productName)

    const message = fillRecapMessage(settings.template, {
      brand: brandGuess,
      product: productName,
      links,
      name: settings.senderName,
      site: settings.siteUrl,
    })

    return NextResponse.json({
      brandGuess,
      product: { name: productName, url: productUrl, isAmazon: isAmazonUrl(productUrl) },
      links,
      settings,
      message,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[brand-recap]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
