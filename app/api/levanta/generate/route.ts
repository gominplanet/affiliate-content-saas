/**
 * POST /api/levanta/generate — turn ONE Levanta product (an Amazon ASIN) into a
 * published WordPress post. Admin-only (Labs). Mirrors the Brand Boost pipeline:
 *   1. mint a commissionable Levanta tracking link for the ASIN (POST /links),
 *   2. enrich the ASIN via the existing Amazon scraper (title/bullets/desc/imgs),
 *   3. light 2-search research brief (scrape-only fallback),
 *   4. campaign writer (Opus, informational) → scrub → WordPress publish,
 *   5. vision-picked hero + CTA image, inline affiliate links.
 * Geniuslink cloaks the Levanta link when the user has creds.
 *
 * Body: { product: { asin, title?, image?, price?, category?, brandName?, marketplace? }, draft?: boolean }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchWpProxySecret } from '@/lib/wp-proxy'
import { createWordPressService } from '@/services/wordpress'
import { createClaudeService, type BrandProfile } from '@/services/claude'
import { createGeniuslinkService } from '@/services/geniuslink'
import { createLevantaLink } from '@/services/levanta'
import { getExternalKey } from '@/lib/external-keys'
import { fetchAmazonProduct, isValidAsin, type AmazonProduct } from '@/services/amazon'
import { researchProduct } from '@/services/research'
import { setCtaThumb, stripCtaThumb } from '@/lib/cta-thumb'
import { injectInlineAffiliateLinks } from '@/lib/inline-affiliate'
import { buildCampaignHero } from '@/lib/hero-image'
import { pickProductReferenceImage } from '@/lib/product-image'
import { scrubBanned } from '@/lib/scrub'
import { spendGate } from '@/lib/ai-spend'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface LevantaProductInput {
  asin?: string
  title?: string
  image?: string | null
  price?: number | string | null
  category?: string | null
  brandName?: string | null
  marketplace?: string
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'MVP x Levanta is a Pro feature.' }, { status: 403 })
    }

    // Monthly AI-spend circuit breaker.
    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const token = await getExternalKey(supabase, user.id, 'levanta')
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Connect your Levanta API key in External Integrations.' }, { status: 400 })
    }

    const body = await request.json() as { product?: LevantaProductInput; draft?: boolean }
    const p = body.product || {}
    const asin = (p.asin || '').trim()
    if (!asin || !isValidAsin(asin)) {
      return NextResponse.json({ ok: false, error: 'A valid Amazon ASIN is required.' }, { status: 400 })
    }
    const marketplace = p.marketplace || 'amazon.com'

    // ── WordPress creds (decrypted) + live proxy secret ──────────────────────
    const wpCreds = await getWordPressCredentials(supabase, user.id)
    if (!wpCreds?.wordpress_url || !wpCreds?.wordpress_username || !wpCreds?.wordpress_app_password) {
      return NextResponse.json({ ok: false, error: 'Connect a WordPress site first (Set up → WordPress).' }, { status: 400 })
    }
    let proxyToken = wpCreds.wordpress_api_token || undefined
    try {
      const liveSecret = await fetchWpProxySecret({
        siteUrl: wpCreds.wordpress_url, username: wpCreds.wordpress_username, appPassword: wpCreds.wordpress_app_password,
      })
      if (liveSecret) proxyToken = liveSecret
    } catch { /* non-fatal */ }
    const wpService = createWordPressService(
      wpCreds.wordpress_url, wpCreds.wordpress_username, wpCreds.wordpress_app_password, proxyToken,
    )

    // ── Brand profile (writer voice) ─────────────────────────────────────────
    const { data: brandRow } = await supabase
      .from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
    if (!brandRow) {
      return NextResponse.json({ ok: false, error: 'Set up your Brand Profile first (Set up → Brand Profile).' }, { status: 400 })
    }
    const brand = brandRow as unknown as BrandProfile

    // ── Enrich the ASIN via the existing Amazon scraper ──────────────────────
    let amz: AmazonProduct | null = null
    try { amz = await fetchAmazonProduct(asin) } catch { amz = null }
    const effTitle = amz?.title || p.title || asin
    const effDescription = amz?.description || ''
    const effBullets = amz?.bullets ?? []
    const effRating = amz?.rating || null
    const priceDisplay = amz?.price || (p.price != null && p.price !== '' ? `$${String(p.price).replace(/^\$/, '')}` : null)

    // ── Levanta tracking link → Geniuslink cloak (optional) ──────────────────
    let affiliateUrl = ''
    let linkSource: 'levanta' | 'bare_url' = 'bare_url'
    try {
      const { url } = await createLevantaLink(token, { asin, marketplace, subid1: 'mvp' })
      if (url) { affiliateUrl = url; linkSource = 'levanta' }
    } catch { /* fall back to the bare Amazon URL below (un-monetized — flagged) */ }
    if (!affiliateUrl) affiliateUrl = `https://www.${marketplace}/dp/${asin}`
    let cloaked = false
    if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url } = await genius.createLinkWithCode(affiliateUrl, effTitle.slice(0, 80))
        if (url) { affiliateUrl = url; cloaked = true }
      } catch { /* non-fatal — fall back to the Levanta link */ }
    }

    // ── Research brief: light 2-search pass, scrape-only fallback ────────────
    let researchBrief = [
      `Product: ${effTitle}`,
      p.brandName ? `Brand: ${p.brandName}` : '',
      p.category ? `Category: ${p.category}` : '',
      priceDisplay ? `Price: ${priceDisplay}` : '',
      effDescription ? `Manufacturer description: ${effDescription.slice(0, 1800)}` : '',
      `Sold on Amazon. Write for a shopper deciding whether this is the right pick: who it suits, what it solves, common buyer questions, and the real trade-offs before buying.`,
    ].filter(Boolean).join('\n')
    try {
      const researchInput: AmazonProduct = amz || {
        asin, title: effTitle, bullets: [], description: '', price: priceDisplay, rating: null,
        imageUrl: p.image || null, images: p.image ? [p.image] : [], priceWas: null, priceSale: null,
        dealBadge: null, dealEndsAt: null, discountPct: null,
      }
      const research = await researchProduct(researchInput, { userId: user.id, tier }, { maxSearches: 2, timeoutMs: 120_000 })
      if (research?.brief) researchBrief = research.brief
    } catch { /* keep the scrape-only brief */ }

    // ── Generate (reuses the campaign writer — informational, no fake testing) ─
    const claude = createClaudeService()
    const generated = await claude.generateCampaignBlogPost(
      brand,
      {
        product: { asin, title: effTitle, bullets: effBullets, description: effDescription, price: priceDisplay, rating: effRating },
        researchBrief,
        affiliateUrl,
        retailer: { isAmazon: true, label: 'Amazon' },
      },
      { userId: user.id, tier },
    )

    const title = scrubBanned(generated.title)
    const excerpt = scrubBanned(generated.excerpt)
    let content = scrubBanned(generated.content)
    const slug = generated.slug || slugify(title)
    content = injectInlineAffiliateLinks(content, effTitle, affiliateUrl, { max: 3 })

    // ── Publish to WordPress ─────────────────────────────────────────────────
    let tagIds: number[] = []
    try { tagIds = await wpService.resolveTagIds((generated.tags || []).slice(0, 10)) } catch { /* non-fatal */ }
    let categoryIds: number[] = []
    if (generated.category) {
      try { categoryIds = [await wpService.createCategory(generated.category)] } catch { /* non-fatal */ }
    }
    const status: 'publish' | 'draft' = body.draft ? 'draft' : 'publish'
    let wpPost
    try {
      wpPost = await wpService.createPost({
        title, slug, content, excerpt, status,
        tags: tagIds, categories: categoryIds, comment_status: 'closed', ping_status: 'closed',
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
    }

    // ── Hero + CTA image (vision-picked clean shot → 16:9 hero, photo floor) ──
    const galleryImages = (amz?.images?.length ? amz.images : (p.image ? [p.image] : []))
      .filter((u): u is string => !!u && /^https?:\/\//i.test(u))
    let cleanProductImage: string | null = null
    try {
      cleanProductImage = (await pickProductReferenceImage(galleryImages, effTitle, { userId: user.id, tier })) || galleryImages[0] || null
    } catch { cleanProductImage = galleryImages[0] || null }

    let heroMediaId: number | null = null
    let heroUrl: string | null = null
    try {
      const hero = await buildCampaignHero({ heroPrompt: generated.imagePrompts?.hero, productImageUrl: cleanProductImage, ctx: { userId: user.id, tier } })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, `${asin}-hero.jpg`, hero.mime)
        heroMediaId = media.id ?? null; heroUrl = media.source_url || null
      }
    } catch { /* fall through to the photo floor */ }
    if (!heroUrl && cleanProductImage) {
      try {
        const media = await wpService.uploadImageFromUrl(cleanProductImage, `${asin}-product.jpg`)
        heroMediaId = media.id ?? null; heroUrl = media.source_url || null
      } catch { /* non-fatal */ }
    }

    const ctaImage = heroUrl || cleanProductImage || null
    let contentChanged = false
    if (ctaImage) {
      const fixed = setCtaThumb(content, ctaImage)
      if (fixed !== content) { content = fixed; contentChanged = true }
    } else {
      const stripped = stripCtaThumb(content)
      if (stripped !== content) { content = stripped; contentChanged = true }
    }
    if (heroMediaId || contentChanged) {
      try {
        await wpService.updatePost(wpPost.id, {
          ...(heroMediaId ? { featured_media: heroMediaId } : {}),
          ...(contentChanged ? { content } : {}),
        })
      } catch { /* non-fatal */ }
    }

    // ── Persist a blog_posts row (Library + social fan-out) ──────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('blog_posts').insert({
        user_id: user.id, title,
        status: status === 'draft' ? 'draft' : 'published',
        post_type: 'review', wordpress_url: wpPost.link, wordpress_post_id: wpPost.id,
      })
    } catch { /* non-fatal */ }

    const editUrl = `${wpCreds.wordpress_url.replace(/\/+$/, '')}/wp-admin/post.php?post=${wpPost.id}&action=edit`
    return NextResponse.json({ ok: true, wordpressUrl: wpPost.link, editUrl, draft: status === 'draft', affiliateUrl, cloaked, linkSource, title })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
