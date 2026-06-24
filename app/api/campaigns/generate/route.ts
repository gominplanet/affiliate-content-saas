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
import { createAdminClient } from '@/lib/supabase/admin'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { fetchWpProxySecret } from '@/lib/wp-proxy'
import { maybeEncrypt } from '@/lib/secrets'
import { rebuildCtaCard } from '@/lib/cta-thumb'
import { injectInlineAffiliateLinks } from '@/lib/inline-affiliate'
import { createGeniuslinkService } from '@/services/geniuslink'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { pickProductReferenceImage } from '@/lib/product-image'
import { researchProduct } from '@/services/research'
import { tierAllowsCampaigns, checkGenerationLimit, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { scrubBanned } from '@/lib/scrub'
import { buildCampaignHero } from '@/lib/hero-image'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'

export const maxDuration = 300

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

// EMERGENCY KILL-SWITCH (2026-06-14): campaign generation was burning runaway
// Anthropic spend during EPC Scout testing. Hard-disabled at the server so no
// client batch, retry, or worker can fire an Opus campaign write. Flip to true
// (or remove this guard) once the cost path is understood + capped.
const CAMPAIGN_GENERATION_ENABLED = true

export async function POST(request: Request) {
  try {
    if (!CAMPAIGN_GENERATION_ENABLED) {
      return NextResponse.json(
        { error: 'Campaign generation is temporarily disabled while we tune its cost controls. Try again shortly.' },
        { status: 503 },
      )
    }
    // Dual-mode auth. Normal: cookie session. Service: the async worker calls
    // this route internally with the CRON_SECRET + the job's identity in headers
    // (mirrors /api/blog/generate) — so the SAME generation pipeline runs off
    // the request path with no 300s ceiling on the user-facing side.
    const svcSecret = request.headers.get('x-mvp-service')
    const isServiceCall = !!svcSecret && svcSecret === process.env.CRON_SECRET
    let supabase: Awaited<ReturnType<typeof createServerClient>>
    let user: { id: string }
    if (isServiceCall) {
      const svcUser = request.headers.get('x-mvp-service-user') || ''
      if (!svcUser) return NextResponse.json({ error: 'Service call missing identity' }, { status: 400 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase = createAdminClient() as unknown as Awaited<ReturnType<typeof createServerClient>>
      user = { id: svcUser }
    } else {
      supabase = await createServerClient()
      const { data: { user: sessionUser } } = await supabase.auth.getUser()
      if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      user = { id: sessionUser.id }
    }

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
    // Idempotency by ASIN: if ANOTHER campaign row for this product already has
    // a published post, don't generate a duplicate (the scout can ingest the
    // same ASIN twice). Short-circuit BEFORE any AI spend. The extra row can be
    // removed from the EPC list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingPub } = await supabase
      .from('campaigns')
      .select('id,wordpress_url,status')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .or('status.eq.published,blog_post_id.not.is.null')
      .limit(1)
      .maybeSingle()
    if (existingPub && existingPub.id !== body.campaignId) {
      return NextResponse.json({
        ok: true,
        alreadyGenerated: true,
        status: 'published',
        wordpressUrl: existingPub.wordpress_url ?? null,
        message: 'A post for this product is already published — skipped to avoid a duplicate. Remove the extra row.',
      })
    }

    // Monthly AI-spend circuit breaker (Opus campaign writer).
    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked

    // Content-piece cap — skip on the worker self-call (enqueue already gated
    // it; re-checking at generate time could fail an already-queued job).
    if (!isServiceCall) {
      const usage = await checkGenerationLimit(supabase, user.id)
      if (!usage.allowed) {
        return NextResponse.json({ error: usage.reason, limitReached: true, cap: 'generations', currentTier: usage.tier, upgrade: usage.upgrade }, { status: 429 })
      }
    }
    // WordPress credentials MUST come from getWordPressCredentials — it reads
    // the canonical multi-site table AND transparently DECRYPTS app_password +
    // api_token (the 2026-06-02 secrets rollout stores them enc:v1:…). Reading
    // intRow.wordpress_* raw handed encrypted blobs to the proxy/Basic-Auth →
    // every write fell through to the blocked cookie-login breaker even though
    // /setup/wp-doctor (which uses this same helper) was all-green. That was
    // the "spent but nothing published" bug.
    const wpCreds = await getWordPressCredentials(supabase, user.id)
    if (!wpCreds?.wordpress_url || !wpCreds?.wordpress_username || !wpCreds?.wordpress_app_password) {
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
    // If a reused row already holds content from a prior run whose PUBLISH
    // failed (the WAF case), we RE-PUBLISH it with zero new AI spend.
    let storedDraft: { title: string; content: string; excerpt: string; slug: string } | null = null
    if (body.campaignId) {
      // Atomically CLAIM the scouted campaign — only proceed if it's still
      // claimable (pending/failed). If it's already 'researching' or
      // 'published', a generation is in flight or already done, so we return
      // its post instead of creating a DUPLICATE (the double-submit bug).
      // Cast past the not-yet-regenerated types (generated_* from migration 128).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: reused } = await (supabase as any)
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
        // 'queued' = the async enqueue parked it for the worker; claim it too.
        .in('status', ['pending', 'failed', 'queued'])
        .select('id,generated_title,generated_content,generated_excerpt,generated_slug')
        .maybeSingle()
      if (reused?.id) {
        campaignId = reused.id as string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = reused as any
        if (r.generated_content && String(r.generated_content).trim()) {
          storedDraft = {
            title: r.generated_title || '',
            content: r.generated_content,
            excerpt: r.generated_excerpt || '',
            slug: r.generated_slug || '',
          }
        }
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

    // WP client (used for publish below). A blocking pre-flight was removed:
    // it kept false-negative-blocking publishes that actually work (reads use
    // Basic-Auth while writes use the body-auth proxy — a host WAF can block
    // the read but allow the write). The real safety nets stand: persist-before-
    // publish means a fresh run never LOSES its spend even if publish fails, and
    // a re-publish (stored draft) costs no AI. So we just attempt the real
    // publish and surface the true result.
    // Proxy-secret self-heal. The body-auth proxy (plugin v1.0.25+) dispatches
    // the write server-side via rest_do_request — the ONLY path that publishes
    // reliably on hosts (Hostinger/LiteSpeed) that WAF-block a large post body
    // or strip the Authorization header on POST. But it only works if the token
    // we send IS the plugin's affiliateos_proxy_secret. The connect-token flow
    // stored the Application Password in wordpress_api_token instead, so the
    // proxy was rejecting every call (bad_token) and writes fell through to the
    // blocked legacy cookie-login. Fetch the live secret from /status (Basic-Auth
    // GET, which hosts pass even when they block POST) and use THAT as the proxy
    // token. Best-effort: if the fetch fails we keep whatever we had.
    let proxyToken = wpCreds.wordpress_api_token || undefined
    const liveSecret = await fetchWpProxySecret({
      siteUrl: wpCreds.wordpress_url,
      username: wpCreds.wordpress_username,
      appPassword: wpCreds.wordpress_app_password,
    })
    if (liveSecret && liveSecret !== wpCreds.wordpress_api_token) {
      proxyToken = liveSecret
      // Persist for next time so we don't re-fetch every publish. Mirror to both
      // the multi-site row and the legacy column (best-effort, non-fatal).
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any
        await Promise.all([
          sb.from('wordpress_sites')
            .update({ api_token: maybeEncrypt(liveSecret) })
            .eq('user_id', user.id).eq('url', wpCreds.wordpress_url),
          sb.from('integrations')
            .update({ wordpress_api_token: maybeEncrypt(liveSecret) })
            .eq('user_id', user.id),
        ])
      } catch { /* non-fatal — the in-memory proxyToken still publishes this run */ }
    }
    const wpService = createWordPressService(
      wpCreds.wordpress_url,
      wpCreds.wordpress_username,
      wpCreds.wordpress_app_password,
      proxyToken,
    )

    // ── 1. Scrape the Amazon product ────────────────────────────────────────
    // Fresh run: required (grounds research + the write). Re-publish: only used
    // for the featured image, so a scrape failure is non-fatal there.
    let product: Awaited<ReturnType<typeof fetchAmazonProduct>> | null = null
    try {
      product = await fetchAmazonProduct(asin)
    } catch (err) {
      if (!storedDraft) return fail(`Couldn't fetch the Amazon product: ${err instanceof Error ? err.message : 'scrape failed'}`)
    }
    if (campaignId && product) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('campaigns').update({ product_title: product.title }).eq('id', campaignId)
    }

    // ── 2. Web research (fresh runs only — re-publish reuses stored content) ─
    let research: Awaited<ReturnType<typeof researchProduct>> | null = null
    if (!storedDraft) {
      try {
        // Cap web searches at 2 (+120s timeout). The Amazon scrape already
        // grounds the post; keeping research short stops it eating the 300s
        // budget before the Opus write (the ECOVACS "stopped before finished"
        // timeouts 2026-06-14).
        research = await researchProduct(product!, { userId: user.id, tier }, { maxSearches: 2, timeoutMs: 120_000 })
      } catch (err) {
        return fail(`Research step failed: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    // ── 3. Affiliate URL — Geniuslink (CC boost rides this), else Amazon tag ─
    let affiliateUrl = `https://www.amazon.com/dp/${asin}`
    let geniuslinkCode: string | null = null
    if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url, code } = await genius.createAsinLinkWithCode(asin, product?.title || asin)
        affiliateUrl = url
        geniuslinkCode = code
      } catch {
        affiliateUrl = `https://www.amazon.com/dp/${asin}${intRow?.amazon_associates_tag ? `?tag=${intRow.amazon_associates_tag}` : ''}`
      }
    } else if (intRow?.amazon_associates_tag) {
      affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${intRow.amazon_associates_tag}`
    }

    // ── 4. Generate the post — OR re-publish a saved draft with NO AI spend ──
    type GeneratedPost = {
      title: string; excerpt: string; content: string; slug?: string
      tags?: string[]; category?: string
      imagePrompts: { hero: string; lifestyle: string; setting: string }
    }
    let generated: GeneratedPost
    if (storedDraft) {
      // The content was already written + PAID FOR on a prior run whose publish
      // failed (the WAF case). Re-publish it verbatim — skip all AI.
      generated = {
        title: storedDraft.title,
        excerpt: storedDraft.excerpt,
        content: storedDraft.content,
        slug: storedDraft.slug,
        tags: [],
        category: '',
        imagePrompts: { hero: '', lifestyle: '', setting: '' },
      }
    } else {
      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('campaigns').update({ status: 'generating' }).eq('id', campaignId)
      }
      const claude = createClaudeService()
      try {
        generated = await claude.generateCampaignBlogPost(brand, {
          product: product!,
          researchBrief: research!.brief,
          affiliateUrl,
        }, { userId: user.id, tier })
      } catch (err) {
        return fail(`Content generation failed: ${err instanceof Error ? err.message : 'unknown'}`)
      }
      // Hard-enforce the banned-word rule before publish/persist.
      generated.title = scrubBanned(generated.title)
      generated.excerpt = scrubBanned(generated.excerpt)
      generated.content = scrubBanned(generated.content)
      generated.imagePrompts = {
        hero: scrubBanned(generated.imagePrompts.hero),
        lifestyle: scrubBanned(generated.imagePrompts.lifestyle),
        setting: scrubBanned(generated.imagePrompts.setting),
      }
      // Hallucination guard — the brief is the only source of truth (ASIN flow,
      // no transcript). Non-fatal; runs before publish so we publish clean once.
      try {
        const checked = await claude.factCheckAndGuard(generated.content, '', research!.brief, { userId: user.id, tier })
        if (checked && checked !== generated.content) generated.content = scrubBanned(checked)
      } catch { /* non-fatal — keep the generated text */ }
    }

    const slug = generated.slug ? slugify(generated.slug) : slugify(generated.title)

    // Weave the affiliate link into the body a few times (on the product name),
    // not just the CTA buttons. Idempotent — no-ops if the writer/prior run
    // already placed inline links. Covers fresh generation + re-publish; runs
    // before the draft is persisted so the stored copy carries the links too.
    generated.content = injectInlineAffiliateLinks(
      generated.content,
      product?.title || generated.title,
      affiliateUrl,
      { max: 3 },
    )

    // Persist the finished post BEFORE publishing (fresh runs only — a
    // re-publish already has it stored). The Opus write is the expensive part;
    // if the WordPress publish then fails (or the run is interrupted), this
    // keeps the paid content recoverable on the campaign row instead of
    // "paid, got nothing." (Incident 2026-06-14.)
    if (campaignId && !storedDraft) {
      // Columns added in migration 128 — cast past the not-yet-regenerated
      // Supabase types (same pattern used elsewhere in this route).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('campaigns').update({
        generated_title: generated.title,
        generated_content: generated.content,
        generated_excerpt: generated.excerpt,
        generated_slug: slug,
      }).eq('id', campaignId)
    }

    // ── 5. Publish to WordPress (wpService built + pre-flighted above) ───────
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
    let heroMediaId: number | null = null
    let heroUrl: string | null = null
    let cleanProductImage: string | null = null
    try {
      if (!product) throw new Error('no product image (re-publish)') // skip hero on re-publish
      // Vision-pick the clean isolated product shot (the Amazon main image is
      // often a lifestyle collage) so the hero grounds on the real product.
      cleanProductImage = (await pickProductReferenceImage(product.images, product.title, { userId: user.id, tier })) || product.imageUrl
      const hero = await buildCampaignHero({
        heroPrompt: generated.imagePrompts?.hero,
        productImageUrl: cleanProductImage || undefined,
        productTitle: product?.title,
        ctx: { userId: user.id, tier },
      })
      if (hero) {
        const media = await wpService.uploadImageFromBase64(hero.b64, `${asin}-hero.jpg`, hero.mime)
        heroMediaId = media.id
        heroUrl = media.source_url || null
        heroKind = hero.kind
      }
    } catch { /* non-fatal — fall through to the product-photo floor below */ }

    // Hero build failed but we have the real product photo → upload it directly
    // so the CTA card + featured image are NEVER empty (user: the CTA box must
    // always carry an image — the product photo is the floor).
    if (!heroUrl && cleanProductImage) {
      try {
        const media = await wpService.uploadImageFromUrl(cleanProductImage, `${asin}-cta.jpg`)
        heroMediaId = media.id
        heroUrl = media.source_url || null
        heroKind = 'product'
      } catch { /* non-fatal — post is live without a featured image */ }
    }

    // Fix the "Get it now" CTA card image: point the thumb at the hero/product
    // photo. stripCtaThumb only as a last resort if we truly have no image.
    // Folded into a single PATCH with featured_media so we don't make an extra
    // round-trip. Non-fatal — the post is already live either way.
    // Rebuild the CTA card fully inline-styled (video-less posts drop the
    // stylesheet, collapsing the class-based card). EPC campaigns are Amazon
    // native → yellow "Get the best price on Amazon" button + image right column.
    const fixedContent = rebuildCtaCard(generated.content, {
      productName: product?.title || generated.title,
      url: affiliateUrl,
      retailerLabel: 'Amazon',
      imageUrl: heroUrl || null,
    })
    const contentChanged = fixedContent !== generated.content
    if (contentChanged) generated.content = fixedContent
    if (heroMediaId || contentChanged) {
      try {
        await wpService.updatePost(wpPost.id, {
          ...(heroMediaId ? { featured_media: heroMediaId } : {}),
          ...(contentChanged ? { content: generated.content } : {}),
        })
      } catch { /* non-fatal — post is live; this only refines the hero + CTA image */ }
    }

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
        ai_model: 'claude-opus-4-8',
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
      citations: research?.citations ?? [],
      republished: !!storedDraft,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
