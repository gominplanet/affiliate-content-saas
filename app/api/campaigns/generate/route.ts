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
import { pickProductReferenceImage } from '@/lib/product-image'
import { researchProduct } from '@/services/research'
import { tierAllowsCampaigns, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { scrubBanned } from '@/lib/scrub'
import { buildCampaignHero } from '@/lib/hero-image'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'

export const maxDuration = 300

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as { asin?: string; campaignName?: string; epc?: string; endsAt?: string; campaignId?: string }
    const asin = extractAsin((body.asin ?? '').toUpperCase()) || (body.asin ?? '').trim()
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'A valid 10-character ASIN is required' }, { status: 400 })
    }

    // ── Pro gate + integration creds ────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
      .eq('user_id', user.id)
      .single()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsCampaigns(tier)) {
      return NextResponse.json({ error: 'Creator Campaigns is a Pro feature.' }, { status: 403 })
    }
    // Monthly AI-spend circuit breaker (Opus campaign writer).
    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked
    if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected. Connect it in Setup first.' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await supabase
      .from('brand_profiles').select('*').eq('user_id', user.id).single()
    if (!brand) {
      return NextResponse.json({ error: 'Brand profile not set up. Complete it first.' }, { status: 400 })
    }

    // ── Track the campaign row up front so failures are visible ─────────────
    // Scouted rows (from the extension ingest) already exist as `pending`;
    // reuse that row instead of inserting a duplicate. Otherwise insert.
    let campaignId: string | undefined
    if (body.campaignId) {
      // Atomically CLAIM the scouted campaign — only proceed if it's still
      // claimable (pending/failed). If it's already 'researching' or
      // 'published', a generation is in flight or already done, so we return
      // its post instead of creating a DUPLICATE (the double-submit bug).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: reused } = await supabase
        .from('campaigns')
        .update({
          status: 'researching',
          campaign_name: body.campaignName?.trim() || null,
          epc: body.epc?.trim() || null,
          ends_at: body.endsAt || null,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.campaignId)
        .eq('user_id', user.id)
        .in('status', ['pending', 'failed'])
        .select('id')
        .maybeSingle()
      if (reused?.id) {
        campaignId = reused.id as string
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await supabase
          .from('campaigns').select('id,status,wordpress_url').eq('id', body.campaignId).eq('user_id', user.id).maybeSingle()
        if (existing) {
          return NextResponse.json({
            ok: true,
            alreadyGenerated: existing.status === 'published',
            status: existing.status,
            wordpressUrl: existing.wordpress_url ?? null,
            message: existing.status === 'published'
              ? 'This campaign already has a published post — skipped to avoid a duplicate.'
              : 'This campaign is already generating — skipped to avoid a duplicate.',
          })
        }
        // campaignId given but no matching row → fall through and insert fresh.
      }
    }
    if (!campaignId) {
      // No reusable campaign. Soft guard against a double-submit for the same
      // ASIN: if one is already in flight, don't start a second.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inflight } = await supabase
        .from('campaigns').select('id,status,wordpress_url')
        .eq('user_id', user.id).eq('asin', asin).eq('status', 'researching')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (inflight?.id) {
        return NextResponse.json({ ok: true, status: 'researching', message: 'A post for this product is already being generated — skipped to avoid a duplicate.' })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: campaignRow } = await supabase
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
      campaignId = campaignRow?.id as string | undefined
    }

    async function fail(message: string, code = 500) {
      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('campaigns')
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
      await supabase.from('campaigns').update({ product_title: product.title }).eq('id', campaignId)
    }

    // ── 2. Web research ─────────────────────────────────────────────────────
    let research
    try {
      research = await researchProduct(product, { userId: user.id, tier })
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
      await supabase.from('campaigns').update({ status: 'generating' }).eq('id', campaignId)
    }
    const claude = createClaudeService()
    let generated
    try {
      generated = await claude.generateCampaignBlogPost(brand, {
        product,
        researchBrief: research.brief,
        affiliateUrl,
      }, { userId: user.id, tier })
    } catch (err) {
      return fail(`Content generation failed: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    // Hard-enforce the banned-word rule on every user-facing field before
    // publish/persist — LLM instructions alone aren't a guarantee.
    generated.title = scrubBanned(generated.title)
    generated.excerpt = scrubBanned(generated.excerpt)
    generated.content = scrubBanned(generated.content)
    generated.imagePrompts = {
      hero: scrubBanned(generated.imagePrompts.hero),
      lifestyle: scrubBanned(generated.imagePrompts.lifestyle),
      setting: scrubBanned(generated.imagePrompts.setting),
    }

    // ── Hallucination guard (parity with blog/generate, 2026-06-09) ─────────
    // Campaign posts have NO YouTube transcript (ASIN-only flow) — the ONLY
    // source of truth is the scraped Amazon product info packed into
    // research.brief. Both helpers tolerate an empty transcript via their
    // "(no transcript provided)" fallback so we pass an empty string and
    // route everything through productResearch.
    //
    // Runs BEFORE WP publish (unlike blog/generate which runs post-publish)
    // because the campaigns route is much shorter — no SEO meta race, no
    // streaming response. We can afford one synchronous pair of Haiku
    // calls before createPost, which means we publish the clean version
    // once instead of patching after.
    try {
      const checked = await claude.factCheckAndGuard(generated.content, '', research.brief, { userId: user.id, tier })
      if (checked && checked !== generated.content) generated.content = scrubBanned(checked)
    } catch { /* non-fatal — keep the generated text */ }

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

    // Category: match the AI's pick against the user's REAL categories
    // (brand niches + custom categories). Never fall back to niches[0]
    // and never create "Blog"/"Uncategorized"/generic — if there's no
    // confident match, leave it unresolved so the UI offers a manual
    // dropdown (chosenCategory stays null).
    let categoryIds: number[] = []
    let chosenCategory: string | null = null
    try {
      const options = [
        ...((brand.niches as string[]) || []),
        ...((brand.custom_categories as string[]) || []),
      ].filter(Boolean)
      const pick = (generated.category || '').trim()
      const GENERIC = /^(blog|uncategorized|general|news|misc|other|posts?)$/i
      const matched = options.find(o => o.toLowerCase() === pick.toLowerCase())
      if (matched) {
        chosenCategory = matched
      } else if (pick && !GENERIC.test(pick)) {
        // AI suggested something specific that isn't one of their saved
        // labels — trust the specific suggestion over a wrong guess.
        chosenCategory = pick
      }
      if (chosenCategory) categoryIds = [await wpService.createCategory(chosenCategory)]
    } catch {
      // Category creation failed — the post still publishes, but it
      // publishes WITHOUT a category. Null `chosenCategory` so the
      // campaigns row reflects reality and the UI offers the manual
      // dropdown instead of showing a category that isn't on the post.
      chosenCategory = null
      categoryIds = []
    }

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

    // Fire IndexNow (Bing / Copilot / Yandex) — best-effort, non-blocking.
    void pingIndexNowForUrl(supabase, user.id, wpPost.link).catch(() => {})

    // Featured image — a 16:9 hero (AI from the hero prompt, else the
    // product photo letterboxed to 16:9). PATCH only featured_media so
    // we don't disturb the already-published title/content/categories.
    let heroKind: 'ai' | 'product' | null = null
    try {
      // Vision-pick the clean isolated product shot (the Amazon main image is
      // often a lifestyle collage) so the hero grounds on the real product.
      const cleanProductImage = (await pickProductReferenceImage(product.images, product.title, { userId: user.id, tier })) || product.imageUrl
      const hero = await buildCampaignHero({
        heroPrompt: generated.imagePrompts?.hero,
        productImageUrl: cleanProductImage,
        ctx: { userId: user.id, tier },
      })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, `${asin}-hero.jpg`, hero.mime)
        await wpService.updatePost(wpPost.id, { featured_media: media.id })
        heroKind = hero.kind
      }
    } catch { /* non-fatal — post is live without a featured image */ }

    // ── 6. Persist blog_posts + finalize campaign ───────────────────────────
    // The post is already LIVE on WordPress at this point. The blog_posts
    // row is what powers the post-publish social fan-out (the pills need a
    // blog_posts.id). Capture the insert error explicitly — swallowing it
    // is what made "pills not showing" undebuggable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: blogRow, error: blogErr } = await supabase
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

    const blogLinked = !!blogRow?.id
    if (campaignId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('campaigns').update({
        status: 'published',
        blog_post_id: blogRow?.id ?? null,
        wordpress_url: wpPost.link,
        category: chosenCategory,
        hero_kind: heroKind,
        // Surface WHY fan-out is unavailable rather than silently null.
        error_message: blogLinked ? null : `Post published, but social fan-out is unavailable: blog_posts insert failed (${blogErr?.message ?? 'unknown'}). Run migration 024 then regenerate.`,
        updated_at: new Date().toISOString(),
      }).eq('id', campaignId)
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      wordpressUrl: wpPost.link,
      title: generated.title,
      socialFanoutAvailable: blogLinked,
      blogInsertError: blogLinked ? null : (blogErr?.message ?? null),
      citations: research.citations,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
