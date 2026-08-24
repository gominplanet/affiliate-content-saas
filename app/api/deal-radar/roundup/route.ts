/**
 * POST /api/deal-radar/roundup  { asins: string[] }
 *
 * On-demand roundup: turn a hand-picked set of Deal Radar deals into ONE
 * curated roundup blog post, published to the creator's WordPress. Same engine
 * as the automatic weekly digest, but manual + instant (the creator chooses the
 * exact products). SEO-complete, with the FTC disclosure. Pro + Labs gated.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, checkGenerationLimit, checkDealsUsage, TIERS, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { applyPostFixes } from '@/lib/seo-fix'
import { resolveAffiliateUrl, generateDigestContent, nicheLabelFrom, keywordSlug, type DigestDeal, type DigestDealRow } from '@/lib/weekly-digest'
import { toUserMessage } from '@/lib/friendly-error'
import { spendGate } from '@/lib/ai-spend'
import { writeContentSchema } from '@/lib/content-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

const DEFAULT_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links, and I may earn a commission at no extra cost to you.'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: intRow } = await sb.from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Amazon Deal Radar is available on paid plans.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { asins?: unknown }
    const asins = (Array.isArray(body.asins) ? body.asins : [])
      .map((a) => String(a).trim().toUpperCase())
      .filter((a) => /^[A-Z0-9]{10}$/.test(a))
    const unique = [...new Set(asins)].slice(0, 12)
    if (unique.length < 2) return NextResponse.json({ error: 'Pick at least 2 deals for a roundup.' }, { status: 400 })

    const { data: rows } = await sb.from('deal_radar_cache')
      .select('asin,title,brand,image_url,price_now_cents,price_was_cents,discount_pct,deal_quality,lowest_label')
      .in('asin', unique)
    const dealRows = (rows ?? []) as DigestDealRow[]
    if (dealRows.length < 2) return NextResponse.json({ error: 'Those deals are no longer on the radar.' }, { status: 404 })
    // Preserve the caller's chosen order.
    dealRows.sort((a, b) => unique.indexOf(a.asin) - unique.indexOf(b.asin))

    const site = await getWordPressCredentials(supabase, user.id)
    if (!site) return NextResponse.json({ error: 'Connect your WordPress site first (Connect Socials / WordPress).' }, { status: 400 })

    const { data: brand } = await sb.from('brand_profiles').select('name,niches,affiliate_disclaimer').eq('user_id', user.id).maybeSingle()
    const niches: string[] = Array.isArray(brand?.niches) ? brand.niches : []
    const tag = (intRow?.amazon_associates_tag || '').trim() || null

    // Resolve every affiliate URL concurrently (was a serial loop — up to 12
    // independent Geniuslink calls awaited one-by-one, ~4-10s of dead latency
    // on a user-facing action). Capped at 12 deals, so plain Promise.all is
    // safe; order is preserved by map.
    const deals: DigestDeal[] = await Promise.all(
      dealRows.map(async (r) => ({
        ...r,
        affiliateUrl: await resolveAffiliateUrl(r.asin, r.title, tag, intRow?.geniuslink_api_key ?? null, intRow?.geniuslink_api_secret ?? null, user.id),
      })),
    )

    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    // Monthly cap — a roundup is one published deal post, so it counts against
    // the tier's allowance exactly like a single deal (previously uncapped, so
    // roundups let a user exceed their plan). Pooled tiers consume a generation
    // unit; Amazon-style tiers (postsPerMonth 0) consume their deal cap.
    if (TIERS[tier]?.postsPerMonth === 0) {
      const d = await checkDealsUsage(supabase, user.id)
      if (!d.allowed) return NextResponse.json({ error: d.reason, limitReached: true, cap: 'deals', currentTier: d.tier, upgrade: d.upgrade }, { status: 429 })
    } else {
      const g = await checkGenerationLimit(supabase, user.id)
      if (!g.allowed) return NextResponse.json({ error: g.reason, limitReached: true, cap: 'generations', currentTier: g.tier, upgrade: g.upgrade }, { status: 429 })
    }

    const client = createAnthropicClient()
    const nicheLabel = nicheLabelFrom(niches)
    const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    const { title, html, excerpt, theme } = await generateDigestContent({
      client, deals, reviewerName: (brand?.name as string) || 'the team', nicheLabel, monthYear,
      recordUsage: (msg) => recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'deal_roundup', model: 'claude-haiku-4-5-20251001' }),
    })

    const disc = ((brand?.affiliate_disclaimer as string | null) || '').trim() || DEFAULT_DISCLOSURE
    const bodyHtml = `<p class="mvp-affiliate-disclosure" style="font-size:13px;color:#6b6b70;font-style:italic;margin:0 0 1.25em"><em>${esc(disc)}</em></p>\n\n${html}`

    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    // File it under a real "Deals" category (create if missing) so it never lands
    // in the site's default "Blog"/"Uncategorized" bucket.
    let categoryIds: number[] = []
    try { const id = await wpService.createCategory('Deals'); if (id) categoryIds = [id] } catch { /* leave as-is rather than fail the post */ }
    // Featured thumbnail — a roundup spans multiple products, so use the lead
    // deal's product image (the AI thumbnail pipeline is single-product). Gives
    // the post a real thumbnail instead of the theme's blank fallback.
    let featuredMediaId: number | null = null
    const heroImage = dealRows.find((r) => r.image_url)?.image_url
    if (heroImage) {
      try {
        const media = await wpService.uploadImageFromUrl(heroImage, `${(theme || 'deals').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deals'}-roundup.jpg`)
        featuredMediaId = (media?.id as number | undefined) ?? null
      } catch (err) { console.warn('[deal-radar/roundup] featured image upload failed:', err instanceof Error ? err.message : err) }
    }
    const slug = keywordSlug(title, theme)
    const wpPost = await wpService.createPost({
      title, slug, content: bodyHtml, excerpt,
      status: 'publish', comment_status: 'closed', ping_status: 'closed',
      ...(categoryIds.length ? { categories: categoryIds } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    })

    const seoKeyword = theme || nicheLabel
    const { data: saved } = await sb.from('blog_posts').insert({
      user_id: user.id, video_id: null, title, slug, content: bodyHtml, excerpt: null,
      wordpress_post_id: wpPost.id, wordpress_url: wpPost.link, wordpress_site_id: site.site_id,
      status: 'published', post_type: 'deal', seo_keyword: seoKeyword,
      // Store every ASIN in the roundup so Deal Radar can mark each of these
      // products as already-posted (the "Posted" badge + "Post again").
      deal_meta: { kind: 'roundup', asins: unique },
      published_at: new Date().toISOString(),
    }).select('id').single()

    if (saved?.id) {
      try {
        await applyPostFixes({
          supabase, userId: user.id, wpService, wpBase: site.wordpress_url.replace(/\/+$/, ''), tier,
          post: { id: saved.id as string, title, slug, content: bodyHtml, seo_keyword: seoKeyword, post_type: 'deal', wordpress_post_id: wpPost.id },
          fixes: 'all',
        })
      } catch (err) { console.warn('[deal-radar/roundup] SEO fix failed (post live):', err instanceof Error ? err.message : err) }
    }

    await writeContentSchema(sb, wpService, {
      userId: user.id,
      siteUrl: site.wordpress_url,
      wpPostId: wpPost.id,
      pageUrl: wpPost.link,
      title,
      description: excerpt,
      html: bodyHtml,
      imageUrl: heroImage || null,
      pageType: 'BlogPosting',
      category: 'Deals',
    })

    return NextResponse.json({ ok: true, url: wpPost.link, count: deals.length })
  } catch (err) {
    console.error('[deal-radar/roundup]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't build the roundup just now. Please try again in a moment.") }, { status: 500 })
  }
}
