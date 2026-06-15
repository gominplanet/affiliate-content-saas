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
import { setCtaThumb, stripCtaThumb } from '@/lib/cta-thumb'
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

    const body = await request.json() as { product?: WMProductInput; brandTrackingUrl?: string; network?: string }
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

    // ── Lightweight research brief from the datafeed (no web research) ───────
    const priceDisplay = p.price ? `$${p.price}` : null
    const researchBrief = [
      `Product: ${p.name}`,
      p.brand ? `Brand: ${p.brand}` : '',
      p.category ? `Category: ${p.category}` : '',
      priceDisplay ? `Price: ${priceDisplay}${p.oldPrice ? ` (was $${p.oldPrice})` : ''}` : '',
      p.description ? `Manufacturer description: ${p.description.slice(0, 1800)}` : '',
      `${body.network ? `Sold via ${body.network}. ` : ''}Write for a shopper deciding whether this is the right pick for them: who it suits, what problems it solves, the most common buyer questions, and the real trade-offs worth knowing before buying.`,
    ].filter(Boolean).join('\n')

    // ── Generate (reuses the campaign writer — informational, no fake testing) ─
    const claude = createClaudeService()
    const generated = await claude.generateCampaignBlogPost(
      brand,
      {
        product: {
          asin: p.sku || '', // no ASIN for Walmart — SKU stands in as the identifier
          title: p.name,
          bullets: [],
          description: p.description || '',
          price: priceDisplay,
          rating: null,
        },
        researchBrief,
        affiliateUrl,
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

    let wpPost
    try {
      wpPost = await wpService.createPost({
        title, slug, content, excerpt,
        status: 'publish',
        tags: tagIds,
        categories: categoryIds,
        comment_status: 'closed',
        ping_status: 'closed',
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
    }

    // ── Featured image + CTA thumb = the real Walmart product photo ───────────
    let heroUrl: string | null = null
    if (p.image) {
      try {
        const media = await wpService.uploadImageFromUrl(p.image, `${(p.sku || 'wmt')}-walmart.jpg`)
        heroUrl = media.source_url || null
        const fixed = heroUrl ? setCtaThumb(content, heroUrl) : stripCtaThumb(content)
        const changed = fixed !== content
        if (changed) content = fixed
        await wpService.updatePost(wpPost.id, {
          ...(media.id ? { featured_media: media.id } : {}),
          ...(changed ? { content } : {}),
        })
      } catch { /* non-fatal — post is live without the featured image */ }
    } else {
      const stripped = stripCtaThumb(content)
      if (stripped !== content) { content = stripped; try { await wpService.updatePost(wpPost.id, { content }) } catch { /* non-fatal */ } }
    }

    // ── Persist a blog_posts row so it shows in Library / social fan-out ─────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('blog_posts').insert({
        user_id: user.id,
        title,
        status: 'published',
        post_type: 'review',
        wordpress_url: wpPost.link,
        wordpress_post_id: wpPost.id,
      })
    } catch { /* non-fatal — the post is already live on WordPress */ }

    return NextResponse.json({
      ok: true,
      wordpressUrl: wpPost.link,
      affiliateUrl,
      cloaked,
      linkSource,
      title,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
