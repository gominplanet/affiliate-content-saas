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
  buildRecapLinks, guessBrandName, cleanProductName, fillRecapMessage,
  DEFAULT_RECAP_TEMPLATE, isAmazonUrl,
  type BrandRecapSettings, type RecapLink,
} from '@/lib/brand-recap'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { asinFromAmazonUrl } from '@/lib/product-link'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'

export const dynamic = 'force-dynamic'

/** Best-effort: go to the source link, resolve to the real Amazon listing, and
 *  read the ACTUAL product title — so the brand name + product name come from
 *  the listing ("AEOCKY 4200 ft² Air Purifier"), not the clickbait video title
 *  ("Can One Air Purifier…"). Bounded by a timeout; returns null on any miss
 *  (the brand field stays editable, so a miss is recoverable). */
async function resolveProductIdentity(productUrl: string | null): Promise<{ name: string; brand: string } | null> {
  if (!productUrl) return null
  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
  try {
    let asin = asinFromAmazonUrl(productUrl) || extractAsin(productUrl)
    if (!asin) {
      const dest = await withTimeout(resolveTrueDestination(productUrl), 5000)
      asin = asinFromAmazonUrl(dest) || extractAsin(dest)
    }
    if (!asin) return null
    const p = await withTimeout(fetchAmazonProduct(asin), 7000)
    if (!p?.title) return null
    return { name: cleanProductName(p.title), brand: guessBrandName(p.title) }
  } catch {
    return null
  }
}

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

    // Brand + product NAME come from the real listing at the source link when
    // we can resolve it; the clickbait video title is only a last-resort
    // fallback. When there's a product URL but the fetch missed, leave the
    // brand blank (the user types it) rather than guess "Can" off the title.
    const real = await resolveProductIdentity(productUrl)
    const titleFallback = (video?.title as string) || (post.title as string) || ''
    const productName = real?.name || titleFallback
    const brandGuess = real?.brand ?? (productUrl ? '' : guessBrandName(titleFallback))

    const message = fillRecapMessage(settings.template, {
      brand: brandGuess,
      product: productName,
      // Default message lists the creator's CONTENT only — not the brand's own
      // product link (the modal keeps that as an opt-in + the product button).
      links: links.filter(l => l.platform !== 'product'),
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
