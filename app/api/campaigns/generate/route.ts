/**
 * POST /api/campaigns/generate
 *
 * The Creator Connections content engine (Phase 1). Given an Amazon ASIN
 * (+ optional campaign metadata), it:
 *   1. scrapes the product
 *   2. runs the web-research agent (Claude + web_search)
 *   3. generates a research-driven, FAQ/problem-solution SEO blog post in
 *      the user's brand voice
 *   4. resolves the Geniuslink affiliate URL (same link the CC commission
 *      boost rides during the campaign window)
 *   5. publishes to WordPress with the product image as the featured image
 *   6. tracks it in the `campaigns` table
 *
 * Pro-tier only. Long-running (research + 32k-token gen + publish).
 *
 * Body: { asin, campaignName?, epc?, endsAt? }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { createGeniuslinkService } from '@/services/geniuslink'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { researchProduct } from '@/services/research'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 300

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as { asin?: string; campaignName?: string; epc?: string; endsAt?: string }
    const asin = extractAsin((body.asin ?? '').toUpperCase()) || (body.asin ?? '').trim()
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid 10-character ASIN is required' }, { status: 400 })
    }

    // ── Pro gate + integration creds ────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
      .eq('user_id', user.id)
      .single()
    const tier = (intRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json({ error: 'Campaign content is a Pro plan feature.' }, { status: 403 })
    }
    if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected. Connect it in Setup first.' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await (supabase as any)
      .from('brand_profiles').select('*').eq('user_id', user.id).single()
    if (!brand) {
      return NextResponse.json({ error: 'Brand profile not set up. Complete it first.' }, { status: 400 })
    }

    // ── Track the campaign row up front so failures are visible ─────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: campaignRow } = await (supabase as any)
      .from('campaigns')
      .insert({
        user_id: user.id,
        asin,
        campaign_name: body.campaignName?.trim() || null,
        epc: body.epc?.trim() || null,
        ends_at: body.endsAt || null,
        status: 'researching',
      })
      .select('id')
      .single()
    const campaignId = campaignRow?.id as string | undefined

    async function fail(message: string, code = 500) {
      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('campaigns')
          .update({ status: 'failed', error_message: message.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', campaignId)
      }
      return NextResponse.json({ error: message }, { status: code })
    }

    // ── 1. Scrape the Amazon product ────────────────────────────────────────
    let product
    try {
      product = await fetchAmazonProduct(asin)
    } catch (err) {
      return fail(`Couldn't fetch the Amazon product: ${err instanceof Error ? err.message : 'scrape failed'}`)
    }
    if (campaignId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('campaigns').update({ product_title: product.title }).eq('id', campaignId)
    }

    // ── 2. Web research ─────────────────────────────────────────────────────
    let research
    try {
      research = await researchProduct(product)
    } catch (err) {
      return fail(`Research step failed: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    // ── 3. Affiliate URL — Geniuslink (CC boost rides this), else Amazon tag ─
    let affiliateUrl = `https://www.amazon.com/dp/${asin}`
    let geniuslinkCode: string | null = null
    if (intRow.geniuslink_api_key && intRow.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url, code } = await genius.createAsinLinkWithCode(asin, product.title)
        affiliateUrl = url
        geniuslinkCode = code
      } catch {
        affiliateUrl = `https://www.amazon.com/dp/${asin}${intRow.amazon_associates_tag ? `?tag=${intRow.amazon_associates_tag}` : ''}`
      }
    } else if (intRow.amazon_associates_tag) {
      affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${intRow.amazon_associates_tag}`
    }

    // ── 4. Generate the blog post ───────────────────────────────────────────
    if (campaignId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('campaigns').update({ status: 'generating' }).eq('id', campaignId)
    }
    const claude = createClaudeService()
    let generated
    try {
      generated = await claude.generateCampaignBlogPost(brand, {
        product,
        researchBrief: research.brief,
        affiliateUrl,
      })
    } catch (err) {
      return fail(`Content generation failed: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    const slug = generated.slug ? slugify(generated.slug) : slugify(generated.title)

    // ── 5. Publish to WordPress ─────────────────────────────────────────────
    const wpService = createWordPressService(
      intRow.wordpress_url,
      intRow.wordpress_username,
      intRow.wordpress_app_password,
      intRow.wordpress_api_token || undefined,
    )

    let tagIds: number[] = []
    try { tagIds = await wpService.resolveTagIds((generated.tags || []).slice(0, 10)) } catch { /* non-fatal */ }

    let categoryIds: number[] = []
    try {
      const niches = (brand.niches as string[]) || []
      const pick = (generated.category || '').trim()
      const matched = niches.find(n => n.toLowerCase() === pick.toLowerCase()) || niches[0] || ''
      if (matched) categoryIds = [await wpService.createCategory(matched)]
    } catch { /* non-fatal */ }

    let wpPost
    try {
      wpPost = await wpService.createPost({
        title: generated.title,
        slug,
        content: generated.content,
        excerpt: generated.excerpt,
        status: 'publish',
        tags: tagIds,
        categories: categoryIds,
        comment_status: 'closed',
        ping_status: 'closed',
      })
    } catch (err) {
      return fail(`WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    // Featured image — the Amazon product photo. (AI thumbnail is a fast follow.)
    if (product.imageUrl) {
      try {
        const media = await wpService.uploadImageFromUrl(product.imageUrl, `${asin}.jpg`)
        await wpService.updatePost(wpPost.id, {
          title: generated.title, slug, content: generated.content,
          excerpt: generated.excerpt, status: 'publish', tags: tagIds, featured_media: media.id,
        })
      } catch { /* non-fatal — post is live without a featured image */ }
    }

    // ── 6. Persist blog_posts + finalize campaign ───────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: blogRow } = await (supabase as any)
      .from('blog_posts')
      .insert({
        user_id: user.id,
        title: generated.title,
        slug,
        content: generated.content,
        excerpt: generated.excerpt,
        status: 'published',
        wordpress_post_id: wpPost.id,
        wordpress_url: wpPost.link,
        ai_model: 'claude-sonnet-4-6',
        generation_prompt_version: 'campaign-v1',
        published_at: new Date().toISOString(),
        ...(geniuslinkCode ? { geniuslink_code: geniuslinkCode } : {}),
      })
      .select('id')
      .single()

    if (campaignId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('campaigns').update({
        status: 'published',
        blog_post_id: blogRow?.id ?? null,
        wordpress_url: wpPost.link,
        updated_at: new Date().toISOString(),
      }).eq('id', campaignId)
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      wordpressUrl: wpPost.link,
      title: generated.title,
      citations: research.citations,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
