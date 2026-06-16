/**
 * POST /api/walmart/generate — turn ONE PartnerBoost Walmart product into a
 * published WordPress post. Admin-only (Labs). Mirrors the EPC campaign
 * pipeline but sourced from the datafeed (no scraping) with a PartnerBoost
 * deep-link cloaked through Geniuslink when the user has it.
 *
 * Affiliate link precedence:
 *   1. the product's own datafeed tracking_url (joined brands),
 *   2. else a deep-link built from the brand's tracking base + product URL,
 *   3. else the bare product URL (last resort, un-monetized — flagged).
 * Then, if Geniuslink creds exist, cloak that link → geni.us.
 *
 * Body: { product: {...datafeed fields...}, brandTrackingUrl?: string }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchWpProxySecret } from '@/lib/wp-proxy'
import { createWordPressService } from '@/services/wordpress'
import { createClaudeService, type BrandProfile } from '@/services/claude'
import { createGeniuslinkService } from '@/services/geniuslink'
import { buildPartnerBoostDeepLink } from '@/services/partnerboost'
import { fetchAmazonProduct, isValidAsin, type AmazonProduct } from '@/services/amazon'
import { researchProduct } from '@/services/research'
import { setCtaThumb, stripCtaThumb } from '@/lib/cta-thumb'
import { buildCampaignHero } from '@/lib/hero-image'
import { pickProductReferenceImage } from '@/lib/product-image'
import { scrubBanned } from '@/lib/scrub'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface WMProductInput {
  name?: string
  price?: string | null
  oldPrice?: string | null
  currency?: string | null
  description?: string
  image?: string | null
  url?: string
  category?: string | null
  brand?: string | null
  merchantName?: string | null
  sku?: string | null
  trackingUrl?: string
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    // ── Admin gate + integration creds ───────────────────────────────────────
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Walmart PB is admin-only while in Labs.' }, { status: 403 })
    }

    const body = await request.json() as { product?: WMProductInput; brandTrackingUrl?: string; network?: string; draft?: boolean }
    const p = body.product || {}
    if (!p.name || !p.url) {
      return NextResponse.json({ ok: false, error: 'A product with at least a name and URL is required.' }, { status: 400 })
    }

    // ── WordPress creds (decrypted) + live proxy secret ──────────────────────
    const wpCreds = await getWordPressCredentials(supabase, user.id)
    if (!wpCreds?.wordpress_url || !wpCreds?.wordpress_username || !wpCreds?.wordpress_app_password) {
      return NextResponse.json({ ok: false, error: 'Connect a WordPress site first (Set up → WordPress).' }, { status: 400 })
    }
    let proxyToken = wpCreds.wordpress_api_token || undefined
    try {
      const liveSecret = await fetchWpProxySecret({
        siteUrl: wpCreds.wordpress_url,
        username: wpCreds.wordpress_username,
        appPassword: wpCreds.wordpress_app_password,
      })
      if (liveSecret) proxyToken = liveSecret
    } catch { /* non-fatal — stored token still publishes */ }
    const wpService = createWordPressService(
      wpCreds.wordpress_url, wpCreds.wordpress_username, wpCreds.wordpress_app_password, proxyToken,
    )

    // ── Brand profile (writer needs the voice) ───────────────────────────────
    const { data: brandRow } = await supabase
      .from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
    if (!brandRow) {
      return NextResponse.json({ ok: false, error: 'Set up your Brand Profile first (Set up → Brand Profile).' }, { status: 400 })
    }
    const brand = brandRow as unknown as BrandProfile

    // ── Affiliate link: datafeed tracking_url → deep-link → bare URL, then cloak ─
    let affiliateUrl = ''
    let linkSource: 'product_tracking' | 'deep_link' | 'bare_url' = 'bare_url'
    if (p.trackingUrl && p.trackingUrl.trim()) {
      affiliateUrl = p.trackingUrl.trim(); linkSource = 'product_tracking'
    } else if (body.brandTrackingUrl && body.brandTrackingUrl.trim()) {
      affiliateUrl = buildPartnerBoostDeepLink(body.brandTrackingUrl.trim(), p.url); linkSource = 'deep_link'
    } else {
      affiliateUrl = p.url; linkSource = 'bare_url'
    }
    let cloaked = false
    if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url } = await genius.createLinkWithCode(affiliateUrl, p.name.slice(0, 80))
        if (url) { affiliateUrl = url; cloaked = true }
      } catch { /* non-fatal — fall back to the PartnerBoost link */ }
    }

    const priceDisplay = p.price ? `$${p.price}` : null

    // ── Enrich Amazon products via the existing scraper ──────────────────────
    // The FBA datafeed has no description/bullets — fetchAmazonProduct(asin)
    // backfills them (+ better images). Best-effort: falls back to datafeed.
    const wantAmazon = body.network === 'Amazon' || (!!p.sku && isValidAsin(p.sku))
    let amz: AmazonProduct | null = null
    if (wantAmazon && p.sku && isValidAsin(p.sku)) {
      try { amz = await fetchAmazonProduct(p.sku) } catch { amz = null }
    }
    const effTitle = amz?.title || p.name
    const effDescription = amz?.description || p.description || ''
    const effBullets = amz?.bullets ?? []
    const effRating = amz?.rating || null
    const heroImage = amz?.imageUrl || p.image || null

    // ── Research brief: a light 2-search web pass (like the EPC path), with a
    //    datafeed-only brief as the fallback if research errors or times out. ─
    let researchBrief = [
      `Product: ${effTitle}`,
      p.brand ? `Brand: ${p.brand}` : '',
      p.category ? `Category: ${p.category}` : '',
      priceDisplay ? `Price: ${priceDisplay}${p.oldPrice ? ` (was $${p.oldPrice})` : ''}` : '',
      effDescription ? `Manufacturer description: ${effDescription.slice(0, 1800)}` : '',
      `${body.network ? `Sold via ${body.network}. ` : ''}Write for a shopper deciding whether this is the right pick: who it suits, what problems it solves, common buyer questions, and the real trade-offs before buying.`,
    ].filter(Boolean).join('\n')
    try {
      const researchInput: AmazonProduct = amz || {
        asin: p.sku || '', title: p.name, bullets: [], description: p.description || '',
        price: priceDisplay, rating: null, imageUrl: p.image || null,
        images: p.image ? [p.image] : [], priceWas: p.oldPrice || null, priceSale: null,
        dealBadge: null, dealEndsAt: null, discountPct: null,
      }
      const research = await researchProduct(researchInput, { userId: user.id, tier }, { maxSearches: 2, timeoutMs: 120_000 })
      if (research?.brief) researchBrief = research.brief
    } catch { /* keep the datafeed-only brief */ }

    // ── Retailer label drives the CTA copy ("Get the best price on Walmart →").
    //    The affiliate link goes to the network's store, so the button must name
    //    it — never default to Amazon for a Walmart product. ───────────────────
    const net = (body.network || 'Walmart').trim().toLowerCase()
    const retailer: { isAmazon: boolean; label: string | null } =
      net === 'amazon' ? { isAmazon: true, label: 'Amazon' }
      : net === 'walmart' ? { isAmazon: false, label: 'Walmart' }
      : { isAmazon: false, label: null } // DTC / other → neutral "Get the best price today →"

    // ── Generate (reuses the campaign writer — informational, no fake testing) ─
    const claude = createClaudeService()
    const generated = await claude.generateCampaignBlogPost(
      brand,
      {
        product: {
          asin: p.sku || '', // Walmart/DTC: SKU stands in; Amazon: the real ASIN
          title: effTitle,
          bullets: effBullets,
          description: effDescription,
          price: priceDisplay,
          rating: effRating,
        },
        researchBrief,
        affiliateUrl,
        retailer,
      },
      { userId: user.id, tier },
    )

    const title = scrubBanned(generated.title)
    const excerpt = scrubBanned(generated.excerpt)
    let content = scrubBanned(generated.content)
    const slug = generated.slug || slugify(title)

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
        title, slug, content, excerpt,
        status,
        tags: tagIds,
        categories: categoryIds,
        comment_status: 'closed',
        ping_status: 'closed',
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
    }

    // ── Designed thumbnail + CTA image. Mirror the EPC hero pipeline: vision-
    //    pick the clean product shot, build a 16:9 hero (AI scene, else the
    //    product letterboxed on white — never a raw oversized cutout), upload it
    //    as the featured image, and point the CTA thumb at it. The CTA box must
    //    ALWAYS carry an image (absolute rule); setCtaThumb inline-sizes it so
    //    it renders correctly even on these video-less posts (no .gr-cta CSS).
    const galleryImages = (amz?.images?.length ? amz.images : (p.image ? [p.image] : []))
      .filter((u): u is string => !!u && /^https?:\/\//i.test(u))
    let cleanProductImage: string | null = null
    try {
      cleanProductImage = (await pickProductReferenceImage(galleryImages, effTitle, { userId: user.id, tier })) || galleryImages[0] || null
    } catch { cleanProductImage = galleryImages[0] || null }

    let heroMediaId: number | null = null
    let heroUrl: string | null = null
    try {
      const hero = await buildCampaignHero({
        heroPrompt: generated.imagePrompts?.hero,
        productImageUrl: cleanProductImage,
        ctx: { userId: user.id, tier },
      })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, `${(p.sku || 'wmt')}-hero.jpg`, hero.mime)
        heroMediaId = media.id ?? null
        heroUrl = media.source_url || null
      }
    } catch { /* fall through to the raw-photo floor below */ }

    // Floor: hero build failed but we have the product photo → upload it so the
    // featured image + CTA are NEVER empty.
    if (!heroUrl && cleanProductImage) {
      try {
        const media = await wpService.uploadImageFromUrl(cleanProductImage, `${(p.sku || 'wmt')}-product.jpg`)
        heroMediaId = media.id ?? null
        heroUrl = media.source_url || null
      } catch { /* non-fatal — post is live without the featured image */ }
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
      } catch { /* non-fatal — post is live without the featured image */ }
    }

    // ── Persist a blog_posts row so it shows in Library / social fan-out ─────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('blog_posts').insert({
        user_id: user.id,
        title,
        status: status === 'draft' ? 'draft' : 'published',
        post_type: 'review',
        wordpress_url: wpPost.link,
        wordpress_post_id: wpPost.id,
      })
    } catch { /* non-fatal — the post is already live on WordPress */ }

    const editUrl = `${wpCreds.wordpress_url.replace(/\/+$/, '')}/wp-admin/post.php?post=${wpPost.id}&action=edit`
    return NextResponse.json({
      ok: true,
      wordpressUrl: wpPost.link,
      editUrl,
      draft: status === 'draft',
      affiliateUrl,
      cloaked,
      linkSource,
      title,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
