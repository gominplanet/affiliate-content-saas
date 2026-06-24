/**
 * POST /api/ltk/generate — turn a creator's LTK pick into a published WordPress
 * post. Admin/Pro-only (Labs). LTK (LiketoKnow.it / ShopLTK) has NO public API
 * and its ToS forbids scraping, so — unlike MVP x Levanta / PartnerBoost — there
 * is no catalogue to browse. The creator brings their OWN commissionable LTK
 * link + a short product description; MVP writes a fact-grounded post around it
 * and uses the LTK link as the CTA. Nothing touches LTK's platform: the link is
 * supplied by the creator (same model as pasting an Amazon tag / Geniuslink).
 *
 * Body: { ltkUrl, productName, description?, imageUrl?, draft? }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchWpProxySecret } from '@/lib/wp-proxy'
import { createWordPressService } from '@/services/wordpress'
import { createClaudeService, type BrandProfile } from '@/services/claude'
import { researchProduct } from '@/services/research'
import type { AmazonProduct } from '@/services/amazon'
import { rebuildCtaCard, embedLtkWidget } from '@/lib/cta-thumb'
import { injectInlineAffiliateLinks } from '@/lib/inline-affiliate'
import { buildCampaignHero } from '@/lib/hero-image'
import { scrubBanned } from '@/lib/scrub'
import { spendGate } from '@/lib/ai-spend'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'MVP x LTK is a Pro feature.' }, { status: 403 })
    }
    // Runs Opus + image gen — respect the spend ceiling like every gen route.
    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const body = await request.json() as { ltkUrl?: string; productName?: string; description?: string; imageUrl?: string; widgetCode?: string; draft?: boolean }
    const ltkUrl = (body.ltkUrl || '').trim()
    const widgetCode = (body.widgetCode || '').trim()
    const productName = (body.productName || '').trim()
    if (ltkUrl && !/^https?:\/\//i.test(ltkUrl)) {
      return NextResponse.json({ ok: false, error: 'That LTK link doesn’t look like a URL — paste your full liketk.it / shopltk.com link.' }, { status: 400 })
    }
    if (widgetCode && (widgetCode.length > 20000 || !widgetCode.includes('<'))) {
      return NextResponse.json({ ok: false, error: 'That LTK widget code doesn’t look right — paste the full HTML snippet LTK gives you for WordPress.' }, { status: 400 })
    }
    if (!ltkUrl && !widgetCode) {
      return NextResponse.json({ ok: false, error: 'Add your LTK link, your LTK widget embed code, or both.' }, { status: 400 })
    }
    if (!productName) {
      return NextResponse.json({ ok: false, error: 'A product name is required (it titles the post).' }, { status: 400 })
    }
    const description = (body.description || '').trim()
    const imageUrl = (body.imageUrl || '').trim() && /^https?:\/\//i.test((body.imageUrl || '').trim()) ? (body.imageUrl as string).trim() : null

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

    const { data: brandRow } = await supabase
      .from('brand_profiles').select('*').eq('user_id', user.id).maybeSingle()
    if (!brandRow) {
      return NextResponse.json({ ok: false, error: 'Set up your Brand Profile first (Set up → Brand Profile).' }, { status: 400 })
    }
    const brand = brandRow as unknown as BrandProfile

    // The LTK link IS the commissionable affiliate link — use it RAW. We do NOT
    // cloak it through Geniuslink: that would wrap LTK's own tracking and could
    // break attribution / the creator's commission.
    const affiliateUrl = ltkUrl

    // ── Research brief: description-first, with a light 2-search web pass to
    //    enrich (best-effort; degrades to the creator's own description). ──────
    let researchBrief = [
      `Product: ${productName}`,
      description ? `What the creator says about it: ${description.slice(0, 1800)}` : '',
      'This product is promoted via the creator’s LTK (LiketoKnow.it) shop. Write for a shopper deciding whether it’s the right pick: who it suits, what problems it solves, common buyer questions, and the real trade-offs.',
    ].filter(Boolean).join('\n')
    try {
      const researchInput: AmazonProduct = {
        asin: '', title: productName, bullets: [], description, price: null, rating: null,
        imageUrl, images: imageUrl ? [imageUrl] : [], priceWas: null, priceSale: null,
        dealBadge: null, dealEndsAt: null, discountPct: null,
      }
      const research = await researchProduct(researchInput, { userId: user.id, tier }, { maxSearches: 2, timeoutMs: 120_000 })
      if (research?.brief) researchBrief = research.brief
    } catch { /* keep the description-only brief */ }

    // ── Generate (campaign writer — informational, no fabricated testing). The
    //    CTA goes to LTK, so the writer uses neutral copy; the end card below is
    //    rebuilt with the LTK-specific button. ──────────────────────────────────
    const claude = createClaudeService()
    const generated = await claude.generateCampaignBlogPost(
      brand,
      {
        product: { asin: '', title: productName, bullets: [], description, price: null, rating: null },
        researchBrief,
        affiliateUrl,
        retailer: { isAmazon: false, label: null },
      },
      { userId: user.id, tier },
    )

    const title = scrubBanned(generated.title)
    const excerpt = scrubBanned(generated.excerpt)
    let content = scrubBanned(generated.content)
    const slug = generated.slug || slugify(title)
    // Inline "Shop it on LTK" links need a real URL — only when the creator gave one.
    if (ltkUrl) content = injectInlineAffiliateLinks(content, productName, affiliateUrl, { max: 3 })

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
        title, slug, content, excerpt, status, tags: tagIds, categories: categoryIds,
        comment_status: 'closed', ping_status: 'closed',
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
    }

    // ── Hero + CTA image (from the creator-supplied image; no scraping). ──────
    let heroMediaId: number | null = null
    let heroUrl: string | null = null
    try {
      const hero = await buildCampaignHero({ heroPrompt: generated.imagePrompts?.hero, productImageUrl: imageUrl || undefined, productTitle: productName, ctx: { userId: user.id, tier } })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, 'ltk-hero.jpg', hero.mime)
        heroMediaId = media.id ?? null
        heroUrl = media.source_url || null
      }
    } catch { /* floor below */ }
    if (!heroUrl && imageUrl) {
      try {
        const media = await wpService.uploadImageFromUrl(imageUrl, 'ltk-product.jpg')
        heroMediaId = media.id ?? null
        heroUrl = media.source_url || null
      } catch { /* non-fatal */ }
    }

    // Shoppable section: if the creator pasted their LTK "Shop the Post" widget,
    // embed the live gallery (it replaces the synthetic button). Otherwise build
    // the self-contained CTA card pointing at their LTK link.
    let contentChanged = false
    if (widgetCode) {
      const embedded = embedLtkWidget(content, widgetCode)
      if (embedded !== content) { content = embedded; contentChanged = true }
    } else {
      const ctaImage = heroUrl || imageUrl || null
      const rebuilt = rebuildCtaCard(content, {
        productName,
        url: affiliateUrl,
        retailerLabel: 'LTK',
        buttonLabel: 'Shop it on LTK →',
        imageUrl: ctaImage,
      })
      if (rebuilt !== content) { content = rebuilt; contentChanged = true }
    }
    if (heroMediaId || contentChanged) {
      try {
        await wpService.updatePost(wpPost.id, {
          ...(heroMediaId ? { featured_media: heroMediaId } : {}),
          ...(contentChanged ? { content } : {}),
        })
      } catch { /* non-fatal */ }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('blog_posts').insert({
        user_id: user.id, title,
        status: status === 'draft' ? 'draft' : 'published',
        post_type: 'review',
        wordpress_url: wpPost.link, wordpress_post_id: wpPost.id,
      })
    } catch { /* non-fatal — post is already live */ }

    const editUrl = `${wpCreds.wordpress_url.replace(/\/+$/, '')}/wp-admin/post.php?post=${wpPost.id}&action=edit`
    return NextResponse.json({ ok: true, wordpressUrl: wpPost.link, editUrl, draft: status === 'draft', title })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
