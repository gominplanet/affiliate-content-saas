import { NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit, TIERS, nextTierFor, allowedBlogImages, normalizeTier, type Tier } from '@/lib/tier'
import { scrubBanned } from '@/lib/scrub'
import { scrubVoicePatterns } from '@/lib/blog-voice-scrub'
import { discoverProductForVideo } from '@/lib/product-detect'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { pickProductReferenceImage } from '@/lib/product-image'
import { researchProductFromUrl, researchProductByWebSearch, fetchProductImageFromPage } from '@/services/research'
import { maybeEvolveLearnProfile } from '@/lib/learn-evolve'
import { gutenbergImageBlock, insertImagesAtHeadings, autoPlacementIndices } from '@/lib/blog-body-images'
import { composeWithNanoBanana, rehostToFal } from '@/lib/thumbnail-generators'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { pickRelatedPosts, renderRelatedLinksBlock, insertRelatedLinks, type LinkCandidate } from '@/lib/internal-links'
import { buildReviewSchemaGraph, parseRating, extractFaqFromHtml } from '@/lib/seo-schema'
import { fal } from '@fal-ai/client'
import { recordUsage } from '@/lib/ai-usage'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { SHOT_PERSPECTIVES, sectionHeadings, generateBodyImagePrompts } from '@/lib/blog-image-prompts'

/** Distinct camera perspectives cycled across a post's in-body images so
 *  no two shots look alike — each Kontext/flux call gets a different angle
 *  + framing even though the product reference is the same. */
// SHOT_PERSPECTIVES, sectionHeadings, generateBodyImagePrompts now live in
// lib/blog-image-prompts.ts (shared with the "Refresh images" route so the
// two image paths can't drift apart).

// firstProductUrl + resolveFinalUrl now live in lib/product-link.ts (shared
// with YouTube Co-Pilot) so the description→product-link resolution can't
// drift between the two pipelines. Imported at the top of this file.

/** Race a promise against a timeout, resolving to `fallback` if it doesn't
 *  settle in time. Used to keep best-effort enrichment (web research) from
 *  consuming the generation function's limited time budget. The underlying
 *  work keeps running but its result is ignored once we've moved on. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

/** Resolve a Geniuslink (or any short URL) to its TRUE product destination,
 *  unwrapping the affiliate redirectors Geniuslink routes through (Sovrn
 *  go.redirectingat.com, Skimlinks, VigLink) which carry the real target in
 *  a `url=`/`u=` query param. Used to VERIFY a freshly-created Geniuslink
 *  actually points where we intended before we publish it. */
async function resolveTrueDestination(url: string): Promise<string> {
  const final = await resolveFinalUrl(url)
  try {
    const u = new URL(final)
    if (/(?:go\.redirectingat\.com|go\.skimresources\.com|redirect\.viglink\.com)$/i.test(u.hostname)) {
      const inner = u.searchParams.get('url') || u.searchParams.get('u')
      if (inner) return decodeURIComponent(inner)
    }
  } catch { /* not parseable — fall through */ }
  return final
}

/** Does `resolved` point at the same product we `intended`? For Amazon we
 *  accept any Amazon locale (geni.us localizes amazon.com → amazon.co.uk
 *  etc.); for a direct store link we require the same registrable host. */
function pointsToIntendedProduct(intended: string, resolved: string, isAmazon: boolean): boolean {
  try {
    const host = (s: string) => new URL(s).hostname.replace(/^www\./i, '').toLowerCase()
    const ih = host(intended)
    const rh = host(resolved)
    if (isAmazon) return /(?:^|\.)amazon\.[a-z.]+$/.test(rh)
    return rh === ih || rh.endsWith('.' + ih) || ih.endsWith('.' + rh)
  } catch {
    return false
  }
}

/** Plain-text word count of Gutenberg block markup (strips wp comments,
 *  HTML tags, and collapses whitespace). Used to scale image count. */
function bodyWordCount(content: string): number {
  const text = content
    .replace(/<!--[\s\S]*?-->/g, ' ')   // wp block comments
    .replace(/<[^>]+>/g, ' ')           // html tags
    .replace(/&[a-z]+;/gi, ' ')         // entities
    .trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}


// Phase 1: Claude generation + WordPress text publish only (~30-40s)
// Images are generated separately via /api/blog/images
export const maxDuration = 300

/** Turn anything thrown into a human-readable string. Plain objects used
 *  to stringify as "[object Object]" via String(err), hiding the real
 *  cause (e.g. Fal / fetch rejections that aren't Error instances). */
function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const maybe = err as { message?: unknown; error?: unknown; detail?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    if (typeof maybe.error === 'string') return maybe.error
    if (typeof maybe.detail === 'string') return maybe.detail
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return 'Unknown server error'
}

export async function POST(request: Request) {
  try {
    return await handleGenerate(request)
  } catch (err: unknown) {
    return NextResponse.json({ error: errToMessage(err) }, { status: 500 })
  }
}

async function handleGenerate(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    videoId?: string
    rewriteFeedback?: string
    includeImages?: boolean
    /** Optional: user-supplied in-article image URLs (public). When present,
     *  these are placed throughout the article INSTEAD of AI-generated ones. */
    userImageUrls?: string[]
    /** Optional: real HD video frames captured by the extension (jpeg data
     *  URLs). When present, in-article photos are these REAL frames retouched
     *  by Nano Banana into editorial, clickable images — not product re-stages. */
    capturedFrames?: string[]
  }
  const { videoId, rewriteFeedback } = body
  // Default ON when omitted (older callers / bulk triggers) — the Content
  // page sends the explicit per-generation choice.
  const includeImages = body.includeImages !== false
  const userImageUrls = Array.isArray(body.userImageUrls)
    ? body.userImageUrls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 3)
    : []
  const capturedFrames = Array.isArray(body.capturedFrames)
    ? body.capturedFrames.filter(f => typeof f === 'string' && f.startsWith('data:image/')).slice(0, 4)
    : []
  if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

  // ── Detect rewrite vs fresh generation ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingForLimit } = await (supabase as any)
    .from('blog_posts')
    .select('id, rewrite_count')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .limit(1)
    .maybeSingle()

  const isRewrite = !!existingForLimit

  if (isRewrite) {
    // ── Rewrite gate (Pro-only, once per post) ──────────────────────────────
    // Manual editing in WordPress is always available; this gate stops the
    // expensive AI rewrite path from being triggered by non-Pro tiers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = normalizeTier(intRow?.tier)
    if (tier !== 'pro' && tier !== 'admin') {
      const next = nextTierFor(tier, 'postsPerMonth')
      return NextResponse.json({
        error: `Rewrite is a Pro feature. You can still manually edit the post in WordPress.${next ? ` Upgrade to ${next.label} to unlock AI rewrites.` : ''}`,
        limitReached: true,
        cap: 'rewrites',
        currentTier: tier,
        upgrade: next,
      }, { status: 403 })
    }
    // Admin (the owner) is unlimited — never capped at one rewrite per post.
    // Pro still gets a single AI rewrite per post.
    const usedRewrites = (existingForLimit.rewrite_count as number) ?? 0
    if (tier !== 'admin' && usedRewrites >= 1) {
      return NextResponse.json({
        error: `This post has already been rewritten once. Pro plans allow one AI rewrite per post — further edits should be made manually in WordPress.`,
        limitReached: true,
        cap: 'rewrites',
        currentTier: tier,
        upgrade: null,
      }, { status: 403 })
    }
  } else {
    // Fresh generation — check the monthly post cap as before.
    const usage = await checkUsageLimit(supabase, user.id)
    if (!usage.allowed) {
      return NextResponse.json({
        error: usage.reason,
        limitReached: true,
        cap: 'posts',
        currentTier: usage.tier,
        upgrade: usage.upgrade,
      }, { status: 403 })
    }
  }
  // Hide-warning for unused references — used below for the prompt.
  void TIERS

  // ── 1. Fetch video ────────────────────────────────────────────────────────
  const { data: video, error: videoErr } = await supabase
    .from('youtube_videos')
    .select('*')
    .eq('user_id', user.id)
    .eq('id', videoId)
    .single()

  if (videoErr || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // ── 2. Fetch brand profile ────────────────────────────────────────────────
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!brand) {
    return NextResponse.json(
      { error: 'Brand profile not set up. Complete your brand profile first.' },
      { status: 400 },
    )
  }

  // ── 3. Fetch WordPress credentials ───────────────────────────────────────
  const { data: integration } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', user.id)
    .single()

  const wp = integration as Record<string, string> | null
  // Function-scope tier (the rewrite gate above has its own narrow copy).
  // Drives the per-tier in-body image ceiling via allowedBlogImages.
  const tier = normalizeTier(wp?.tier)
  if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
    return NextResponse.json(
      { error: 'WordPress not connected. Add your WordPress credentials in Settings.' },
      { status: 400 },
    )
  }

  // ── 4. Fetch transcript ───────────────────────────────────────────────────
  let transcript = (video as Record<string, string>).transcript || ''
  if (!transcript) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(
        (video as Record<string, string>).youtube_video_id,
        { lang: 'en' },
      )
      transcript = segments.map((s: { text: string }) => s.text).join(' ')
      await supabase
        .from('youtube_videos')
        .update({ transcript, transcript_fetched_at: new Date().toISOString() })
        .eq('id', videoId)
    } catch {
      transcript = ''
    }
  }

  // Hard gate: without a usable transcript we cannot write an authentic
  // first-person review. The previous behaviour — silently proceeding with
  // an empty transcript and producing meta-disclaimers like "this video was
  // filmed without an accompanying transcript" inside the article — has been
  // explicitly rejected. Fail early with an actionable message so the user
  // can fix the underlying issue rather than ship a flimsy post.
  if (!transcript || transcript.trim().length < 80) {
    return NextResponse.json({
      error: 'We couldn’t fetch a transcript for this video, so we can’t write an authentic review. Try one of these:\n  1. Enable captions in YouTube Studio → Subtitles (auto-captions usually appear within 24h of upload).\n  2. If captions exist, wait a moment and retry — the transcript service occasionally throttles.\n  3. Skip this video and pick one with captions.',
      reason: 'no_transcript',
    }, { status: 422 })
  }

  // ── 5. Resolve the product / affiliate link ───────────────────────────────
  // Priority:
  //   1. Amazon ASIN in the title or an Amazon product URL in the
  //      description → Amazon path (Geniuslink/Associates).
  //   2. NO Amazon link, but the creator linked the product directly on a
  //      store/brand site (e.g. "Check Today's Price and Availability here:
  //      <store URL>") → USE THAT LINK. Do NOT blindly search Amazon for a
  //      lookalike — the creator isn't selling it on Amazon.
  //   3. Only when there's no usable link at all → fall back to Amazon
  //      product discovery (search by name).
  const v = video as Record<string, unknown>
  const rawTitle = v.title as string
  const rawDescription = (v.description as string) || ''
  let asinOverride: string | null = null
  let affiliateUrlOverride: string | null = null

  // Step 1 — find the RAW destination the creator points buyers to.
  const titleAsin = extractAsin(rawTitle.toUpperCase())
  const descAsin = rawDescription.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase()
  let destination: string | null = null
  let alreadyGeniuslink = false
  if (titleAsin || descAsin) {
    asinOverride = titleAsin || descAsin || null
    destination = `https://www.amazon.com/dp/${asinOverride}`
  } else {
    const directProductUrl = firstProductUrl(rawDescription, wp?.wordpress_url ?? null)
    if (directProductUrl) {
      if (/(?:geni\.us|\bgnz\.)/i.test(directProductUrl)) {
        // Already a Geniuslink (could point anywhere) — keep it as-is.
        destination = directProductUrl
        alreadyGeniuslink = true
      } else if (/(?:amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(directProductUrl)) {
        // A short link — LOOK IT UP before assuming. If it lands on an
        // Amazon product, treat it as Amazon (extract the ASIN); otherwise
        // use whatever store it actually points to.
        const finalUrl = await resolveFinalUrl(directProductUrl)
        const asinFromFinal = finalUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]
        if (asinFromFinal) {
          asinOverride = asinFromFinal.toUpperCase()
          destination = `https://www.amazon.com/dp/${asinOverride}`
        } else {
          destination = finalUrl
        }
      } else {
        // The creator's direct store / product page (any domain).
        destination = directProductUrl
      }
    } else {
      // No usable link anywhere → last-resort Amazon product discovery.
      const discovered = await discoverProductForVideo(rawTitle, rawDescription, { userId: user.id, tier: (wp?.tier as string) ?? null })
      if (discovered.asin) {
        asinOverride = discovered.asin
        destination = `https://www.amazon.com/dp/${discovered.asin}`
      }
    }
  }

  // Step 2 — turn the destination into the link used throughout the post.
  // If the user has Geniuslink connected, wrap ANY destination with it
  // (Geniuslink is NOT Amazon-only — it tracks/redirects any URL). If the
  // creator's link is already a Geniuslink, keep it. Else fall back to the
  // Amazon Associates tag (Amazon only) or the raw URL.
  if (destination) {
    if (alreadyGeniuslink) {
      affiliateUrlOverride = destination
    } else if (wp?.geniuslink_api_key && wp?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
        const wrapped = await genius.createLink(destination, rawTitle)
        // GUARDRAIL: a misconfigured/duplicate Geniuslink can resolve to an
        // UNRELATED destination (e.g. the account's default Hostinger promo
        // link) instead of this product. Verify the created link actually
        // points at the product we intended before publishing it — if it
        // doesn't, never use it; fall back to the real product URL so the
        // post can't link readers somewhere irrelevant.
        const trueDest = await resolveTrueDestination(wrapped)
        if (pointsToIntendedProduct(destination, trueDest, !!asinOverride)) {
          affiliateUrlOverride = wrapped
        } else {
          console.warn(`[blog/generate] Geniuslink ${wrapped} resolved to "${trueDest}", not the intended product "${destination}" — falling back to the raw product URL.`)
          affiliateUrlOverride = (asinOverride && wp?.amazon_associates_tag)
            ? `https://www.amazon.com/dp/${asinOverride}?tag=${wp.amazon_associates_tag}`
            : destination
        }
      } catch {
        affiliateUrlOverride = destination
      }
    } else if (asinOverride && wp?.amazon_associates_tag) {
      affiliateUrlOverride = `https://www.amazon.com/dp/${asinOverride}?tag=${wp.amazon_associates_tag}`
    } else {
      affiliateUrlOverride = destination
    }
  }

  // ── 5.1. Resolve the product URL we'll surface in the dashboard so the
  //         creator can click through and confirm it's the right product
  //         (this same ASIN drives the in-body image rendering). Prefer the
  //         discovery-built affiliate URL; otherwise build a plain Amazon
  //         /dp link with the Associates tag when set. No extra Geniuslink
  //         call here — this is a "visit the product" link, not a tracked
  //         click target.
  const effectiveAsin =
    extractAsin(rawTitle.toUpperCase()) ||
    rawDescription.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ||
    asinOverride ||
    null
  let productUrl: string | null = affiliateUrlOverride
  if (!productUrl && effectiveAsin) {
    productUrl = wp?.amazon_associates_tag
      ? `https://www.amazon.com/dp/${effectiveAsin}?tag=${wp.amazon_associates_tag}`
      : `https://www.amazon.com/dp/${effectiveAsin}`
  }
  if (productUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('youtube_videos').update({ product_url: productUrl }).eq('id', videoId)
  }

  // ── Persistent feedback: every "what was missing" note this user
  // has ever typed into the Rewrite modal. These accumulate over time
  // and apply to every new generation — the AI keeps learning what
  // this user actually wants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feedbackRows } = await (supabase as any)
    .from('blog_posts')
    .select('last_rewrite_feedback,published_at')
    .eq('user_id', user.id)
    .not('last_rewrite_feedback', 'is', null)
    .order('published_at', { ascending: false })
    .limit(8)
  const persistentFeedback = (feedbackRows as Array<{ last_rewrite_feedback: string | null }> | null)
    ?.map(r => (r.last_rewrite_feedback || '').trim())
    .filter(s => s.length > 0)
    .slice(0, 8) ?? []

  // ── Voice anchors: pull the user's 2 most-recently-published posts
  // so Claude can match their voice on every new generation. This is
  // the feedback loop — the more they ship, the more "them" each new
  // draft sounds. Excluded: the post being rewritten (would self-
  // mirror) and posts without content. Shortened to ~1200 chars each
  // to keep the prompt budget reasonable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorRows } = await (supabase as any)
    .from('blog_posts')
    .select('title,content,video_id')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .neq('video_id', videoId)
    .order('published_at', { ascending: false })
    .limit(2)
  const priorExamples = (priorRows as Array<{ title: string; content: string }> | null)?.map(p => ({
    title: p.title,
    // Strip WP blocks + HTML tags so the example reads as the prose
    // Claude originally produced, not a wall of markup.
    excerpt: (p.content || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200),
  })).filter(ex => ex.excerpt.length > 100) ?? []

  // ── Internal-link candidates (SEO #15): the user's recent published posts
  // with a public URL. We score these by topical overlap against the new post
  // AFTER it's written and surface the best 2–3 as a "Related reviews" block —
  // real topical internal linking, not random related. Best-effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linkRows } = await (supabase as any)
    .from('blog_posts')
    .select('title,wordpress_url,seo_keyword')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .neq('video_id', videoId)
    .not('wordpress_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20)
  const linkCandidates: LinkCandidate[] = (linkRows as Array<{ title: string; wordpress_url: string; seo_keyword: string | null }> | null)
    ?.filter(r => r.title && r.wordpress_url)
    .map(r => ({ title: r.title, url: r.wordpress_url, keyword: r.seo_keyword })) ?? []

  // ── 5.9. Web product research — scrape the product/brand site the
  //         creator linked in the description for factual product info,
  //         the open-web equivalent of an Amazon scrape. The transcript
  //         still drives the voice; this just gives the writer real
  //         product facts. Creator/Pro/Admin (not Trial); best-effort.
  let productResearch: string | null = null
  if (tier === 'creator' || tier === 'pro' || tier === 'admin') {
    const pUrl = firstProductUrl(rawDescription, wp?.wordpress_url ?? null)
    if (pUrl) {
      // HARD TIME BUDGET: research is best-effort enrichment, but the
      // fallback web_search can run 60–90s with no cap. Left unbounded it
      // starves the main generation of the function's 300s budget, so the
      // streamed Claude call gets cut off mid-flight ("terminated"). Cap the
      // whole research step; on timeout we proceed transcript-only.
      productResearch = await withTimeout(
        (async () => {
          let r = (await researchProductFromUrl(pUrl, rawTitle, { userId: user.id, tier })) || null
          // Direct fetch came back empty (JS-rendered / scraper-blocked page).
          // Fall back to web search by product name. Pricier, so only here.
          if (!r) r = (await researchProductByWebSearch(rawTitle, pUrl, { userId: user.id, tier })) || null
          return r
        })(),
        55000,
        null,
      )
    }
  }

  // ── 6. Generate blog post with Claude ─────────────────────────────────────
  const claude = createClaudeService()
  let generated
  try {
    generated = await claude.generateBlogPost(
      {
        name: (brand as Record<string, unknown>).name as string || '',
        author_name: (brand as Record<string, unknown>).author_name as string | null,
        tagline: (brand as Record<string, unknown>).tagline as string | null,
        website_url: (brand as Record<string, unknown>).website_url as string | null,
        niches: ((brand as Record<string, unknown>).niches as string[]) || [],
        tone: ((brand as Record<string, unknown>).tone as string[]) || [],
        post_length: (brand as Record<string, unknown>).post_length as string || 'medium',
        cta_style: (brand as Record<string, unknown>).cta_style as string || 'soft_recommendation',
        affiliate_disclaimer: (brand as Record<string, unknown>).affiliate_disclaimer as string | null,
        writing_sample: (brand as Record<string, unknown>).writing_sample as string | null,
        author_bio: (brand as Record<string, unknown>).author_bio as string | null,
        target_audience: (brand as Record<string, unknown>).target_audience as string | null,
        words_to_avoid: (brand as Record<string, unknown>).words_to_avoid as string | null,
        learn_profile: (brand as Record<string, unknown>).learn_profile,
      },
      {
        videoId: v.youtube_video_id as string,
        title: rawTitle,
        description: rawDescription,
        tags: (v as Record<string, string[]>).tags || [],
        transcript,
        asinOverride,
        affiliateUrlOverride,
        productResearch,
      },
      { userId: user.id, tier: (wp?.tier as string) ?? null },
      isRewrite ? (rewriteFeedback?.trim() || null) : null,
      priorExamples,
      persistentFeedback,
    )
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : (errToMessage(err) || 'Claude generation failed')
    await logFailure(supabase, user.id, videoId, 'blog_generation', rawMsg)
    // Translate low-level stream/network errors (undici "terminated",
    // "fetch failed", socket resets, timeouts) into something a user can
    // act on instead of a cryptic one-word error.
    const transient = /terminated|fetch failed|socket|ECONNRESET|aborted|network|timeout|overloaded|52\d|50[23]/i.test(rawMsg)
    const msg = transient
      ? 'The AI connection dropped partway through generating this post. This is usually temporary — please hit Retry.'
      : rawMsg
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 5.5. Hard-enforce the banned-word rule on every user-facing field.
  //         LLM instructions aren't a guarantee; this is the last line of
  //         defense before anything is published or persisted.
  generated.title = scrubBanned(generated.title)
  generated.excerpt = scrubBanned(generated.excerpt)
  generated.content = scrubBanned(generated.content)
  // Phase 2 / Track A SEO fields (may be absent on an older prompt parse).
  generated.metaDescription = scrubBanned(generated.metaDescription || '')
  generated.seoKeyword = scrubBanned(generated.seoKeyword || '')
  generated.imagePrompts = {
    hero: scrubBanned(generated.imagePrompts.hero),
    lifestyle: scrubBanned(generated.imagePrompts.lifestyle),
    setting: scrubBanned(generated.imagePrompts.setting),
  }

  // ── 5.6. Title identity fact-check (critical path — tiny, fast Haiku call) ──
  //         The title seeds the slug, the URL, and every section, so an invented
  //         product IDENTITY here (e.g. a plain water bottle titled "2-in-1 Water
  //         Bottle LED Lantern") poisons the whole post. Catch it BEFORE publish
  //         so we can also re-derive a clean slug — no live-URL churn later. The
  //         body fact-check (in after()) then strips any matching invented claims.
  //         Best-effort: factCheckTitle returns the original on any failure.
  try {
    const checkedTitle = scrubBanned(await claude.factCheckTitle(
      generated.title,
      transcript,
      productResearch,
      { userId: user.id, tier: (wp?.tier as string) ?? null },
    ))
    if (checkedTitle && checkedTitle.trim() && checkedTitle.trim() !== generated.title.trim()) {
      console.log('[blog-factcheck-title] corrected invented identity', { from: generated.title, to: checkedTitle.trim() })
      generated.title = checkedTitle.trim()
      // Re-derive the slug from the corrected title so no invented term
      // (e.g. "lantern") leaks into the URL/slug.
      const reslug = generated.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60)
      if (reslug) generated.slug = reslug
    }
  } catch { /* non-fatal — keep the generated title/slug */ }

  // ── 6. Clean any vestigial placeholders (the prompt no longer emits
  //        these, but strip defensively in case an old prompt variant does) ─
  let content = generated.content
    .replace('{{LIFESTYLE_IMAGE}}', '')
    .replace('{{SETTING_IMAGE}}', '')

  // Deterministic voice-betrayal scrub — drops paragraphs that violate the
  // "you ARE the person in the video" rule (the prompt forbids these but the
  // model occasionally slips past). Belt-and-suspenders so the WP publish
  // below never ships an article with "from what we see in the video…" or
  // "watch the full video before deciding…" filler.
  {
    const scrub = scrubVoicePatterns(content)
    content = scrub.content
    if (scrub.paragraphsRemoved + scrub.phrasesRewritten > 0) {
      console.log(`[blog/generate] voice scrub: dropped ${scrub.paragraphsRemoved} paragraph(s), rewrote ${scrub.phrasesRewritten} phrase(s)`)
    }
  }

  // ── 6.1. Topical internal linking (SEO #15) — pick the 2–3 most relevant of
  //         the user's existing posts by token overlap and splice a "Related
  //         reviews" block before the FAQ. Skipped when nothing is relevant.
  try {
    const related = pickRelatedPosts(
      {
        title: generated.title,
        keyword: generated.seoKeyword || null,
        tags: generated.tags || [],
        niches: ((brand as Record<string, unknown>).niches as string[]) || [],
        category: generated.category || null,
      },
      linkCandidates,
      3,
    )
    if (related.length > 0) {
      content = insertRelatedLinks(content, renderRelatedLinksBlock(related))
    }
  } catch { /* internal links are best-effort; never block generation */ }

  const slug = generated.slug.slice(0, 60)

  // ── 7. Resolve tag IDs ────────────────────────────────────────────────────
  const wpService = createWordPressService(
    wp.wordpress_url,
    wp.wordpress_username,
    wp.wordpress_app_password,
    wp.wordpress_api_token || undefined,
  )

  // ── 7.05. Auto in-body images are generated AFTER the response is sent
  //          (see the `after()` block near the end). They used to run here,
  //          on the critical path before publish — a deep post + several Fal
  //          images + WordPress media uploads could push the request past
  //          the 300s function limit (504). Now we publish the text post
  //          immediately with correct links, then splice images in via a
  //          follow-up updatePost, so a slow image stage can never fail the
  //          whole generation.

  let tagIds: number[] = []
  try {
    tagIds = await wpService.resolveTagIds(generated.tags.slice(0, 10))
  } catch (err) {
  }

  // ── 7.1. Resolve category — priority order:
  //         1. User's explicit pick on youtube_videos.selected_category
  //            (set via the dropdown next to "Generate post" on Content page)
  //         2. AI's pick from generated.category, if it matches a brand niche
  //         3. First brand niche as a fallback
  let categoryIds: number[] = []
  try {
    const niches = ((brand as Record<string, unknown>).niches as string[]) || []
    const userPick = ((video as Record<string, unknown>).selected_category as string | null)?.trim() || ''
    const aiPick = (generated.category || '').trim()
    // Find the niche label in a case-insensitive way so minor casing drift
    // ("home & kitchen" vs "Home & Kitchen") still resolves cleanly.
    const matched = userPick
      ? userPick // honor user pick verbatim — they may have picked outside niches
      : (niches.find(n => n.toLowerCase() === aiPick.toLowerCase()) || niches[0] || '')
    if (matched) {
      const catId = await wpService.createCategory(matched)
      categoryIds = [catId]
    }
  } catch { /* non-fatal */ }

  // ── 7.5. Sync author profile to WordPress (E-E-A-T #16) ───────────────────
  // Push display name + bio + website so the byline-linked author archive page
  // becomes a real author-authority page. Only what the user actually provided
  // (no fabrication). Social profiles ride along in each post's Person schema.
  const authorName = (brand as Record<string, unknown>).author_name as string | null
  const authorBio = (brand as Record<string, unknown>).author_bio as string | null
  const authorWebsite = (brand as Record<string, unknown>).website_url as string | null
  if (authorName || authorBio || authorWebsite) {
    try {
      await wpService.updateCurrentUserProfile({ displayName: authorName, bio: authorBio, url: authorWebsite })
    } catch { /* non-fatal */ }
  }

  // ── 8. Publish text post to WordPress ────────────────────────────────────
  let wpPost
  try {
    wpPost = await wpService.createPost({
      title: generated.title,
      slug,
      content,
      excerpt: generated.excerpt,
      status: 'publish',
      tags: tagIds,
      categories: categoryIds,
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : (errToMessage(err) || 'WordPress publish failed')
    await logFailure(supabase, user.id, videoId, 'wp_publish', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Fire IndexNow (Bing / Copilot / Yandex) for near-instant crawling of the new
  // URL — fire-and-forget so a slow or rejected ping NEVER blocks the response.
  // Google doesn't participate; the daily GSC sweep covers Google.
  void pingIndexNowForUrl(supabase, user.id, wpPost.link).catch(() => {})

  // ── 8.5. Upload YouTube thumbnail as featured image ───────────────────────
  const youtubeVideoId = (v as Record<string, unknown>).youtube_video_id as string
  try {
    const thumbUrl = `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`
    let media
    try {
      media = await wpService.uploadImageFromUrl(thumbUrl, `${youtubeVideoId}.jpg`)
    } catch {
      const fallback = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`
      media = await wpService.uploadImageFromUrl(fallback, `${youtubeVideoId}.jpg`)
    }
    await wpService.updatePost(wpPost.id, {
      title: generated.title, slug, content, excerpt: generated.excerpt,
      status: 'publish', tags: tagIds, featured_media: media.id,
    })
  } catch { /* non-fatal — post is already published without thumbnail */ }

  // ── 9. Save to blog_posts (upsert so re-generates update the WP post ID) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingPost } = await (supabase as any)
    .from('blog_posts')
    .select('id')
    .eq('user_id', user.id)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Extract the Geniuslink shortcode from the YouTube description so we can
  // tie it back to this post in /api/analytics/clicks. The link itself is
  // already created upstream (during generate-metadata) and lives in the
  // YouTube description; we just persist the code here for join purposes.
  const geniuslinkCode = extractGeniuslinkCode(
    (video as Record<string, unknown>).description as string | null | undefined,
  )

  const blogPayload = {
    user_id: user.id,
    video_id: videoId,
    title: generated.title,
    slug,
    content,
    excerpt: generated.excerpt,
    status: 'published',
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    ai_model: 'claude-sonnet-4-6',
    generation_prompt_version: 'v3.0',
    published_at: new Date().toISOString(),
    image_prompts: generated.imagePrompts,
    ...(geniuslinkCode ? { geniuslink_code: geniuslinkCode } : {}),
    // Track rewrite usage so the next attempt on the same post can be
    // blocked (Pro gets one AI rewrite per post). Only mutate these
    // fields when this *is* a rewrite — fresh generations leave them
    // at the defaults (0 / null).
    ...(isRewrite
      ? {
          rewrite_count: 1,
          last_rewrite_feedback: rewriteFeedback?.trim() || null,
        }
      : {}),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ep = existingPost as any
  let savedPost
  if (ep?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('blog_posts')
      .update(blogPayload)
      .eq('id', ep.id)
      .select()
      .single()
    savedPost = data
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('blog_posts')
      .insert(blogPayload)
      .select()
      .single()
    savedPost = data
  }

  // ── Persist Phase 2 / Track A SEO fields (best-effort) ────────────────────
  // Separate from the core payload so a deploy that lands BEFORE migration 065
  // runs can never fail the post save — once the columns exist these populate
  // for the re-optimise loop. The rendered <head> meta does NOT depend on this
  // (it's written via WP post meta in the after() block above).
  if (savedPost?.id && (generated.seoKeyword || generated.metaDescription)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('blog_posts')
        .update({
          seo_keyword: generated.seoKeyword || null,
          meta_description: ((generated.metaDescription || generated.excerpt) || '').slice(0, 300) || null,
        })
        .eq('id', savedPost.id)
    } catch { /* columns may not exist until migration 065 runs — non-fatal */ }
  }

  // Fire-and-forget LEARN-profile evolution. Reads the user's last 5
  // posts + current profile, fills empty slots with AI-inferred
  // suggestions (never overwrites manual entries). Debounced 6h so a
  // burst of publishes doesn't hammer Haiku. No await — request keeps
  // moving so the user's blog-publish flow stays fast.
  void maybeEvolveLearnProfile(supabase, { userId: user.id, tier: (wp?.tier as string) ?? null })

  // ── 10. Body images + cache purge — DEFERRED to after the response ────────
  // The text post is already published (correct links) and saved, so the user
  // gets it immediately. Next.js `after()` runs this within the same
  // function's remaining time budget; if image generation is slow or the
  // function is cut off, the published post simply keeps its text — the
  // request can NEVER 504 on the user because of images.
  after(async () => {
    // ── Video→blog backlink (SEO #21) ──────────────────────────────────────
    // Append a "Full written review" link to the source YouTube video's
    // description so the video drives authority to the post (and vice versa).
    // User-controllable (integrations.yt_backlink_enabled, default true) since
    // it writes to their own channel; needs YouTube OAuth. Fully best-effort.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ytRow } = await (supabase as any)
        .from('integrations')
        .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry,yt_backlink_enabled')
        .eq('user_id', user.id)
        .single()
      if (ytRow?.yt_backlink_enabled !== false && ytRow?.youtube_oauth_access_token && youtubeVideoId && wpPost.link) {
        const token = await getValidYouTubeToken(ytRow as Record<string, unknown>)
        const yt = createYouTubeOAuthService(token)
        const pushed = await yt.appendBlogLinkToDescription(youtubeVideoId, wpPost.link as string)
        console.log('[blog-backlink]', pushed ? `linked ${youtubeVideoId} → ${wpPost.link}` : 'skipped (already linked or no snippet)')
      }
    } catch (err) {
      console.warn('[blog-backlink] failed (non-fatal):', err instanceof Error ? err.message : String(err))
    }

    const ytThumb = `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`
    const initialProductImage = ((v as Record<string, unknown>).product_image_url as string | null)?.trim() || null

    // Descriptive, keyword-bearing alt text for in-body images (image SEO +
    // accessibility) — replaces the old "<title> — 2" placeholder. Varies the
    // descriptor per slot so each image's alt is distinct.
    const altBase = (generated.seoKeyword || generated.title || '').trim()
    const ALT_DESCRIPTORS = ['in use', 'close-up detail', 'in a real setting', 'hands-on', 'key feature', 'overview']
    const altFor = (i: number) => altBase ? `${altBase} — ${ALT_DESCRIPTORS[i % ALT_DESCRIPTORS.length]}` : `Product review image ${i + 1}`

    // ── SEO/AEO structured data writer (idempotent — safe to call twice) ─────
    // Builds the JSON-LD @graph + meta and writes them as post meta; the MVP
    // plugin renders them in <head>. Called FIRST below (guaranteed delivery —
    // before the fact-check or image gen, which are the things that can hang or
    // exhaust the after() budget), then optionally again once images resolve to
    // upgrade og:image to the AI hero + the real product name/image. Non-fatal.
    const writeSeoMeta = async (ogImage: string, productName: string, productImage: string | null) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = brand as Record<string, any>
        const vrow = v as Record<string, unknown>
        const wpBaseUrl = (wp.wordpress_url || '').replace(/\/$/, '')
        const catSlug = (generated.category || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        const graph = buildReviewSchemaGraph({
          pageUrl: wpPost.link,
          title: generated.title,
          description: generated.excerpt,
          datePublished: (savedPost?.published_at as string) || new Date().toISOString(),
          imageUrl: ogImage,
          // Author-authority + entity signals (2026 E-E-A-T): bio, headshot,
          // job title, expertise topics, brand socials. All optional/additive.
          author: {
            name: (b.author_name as string) || (b.name as string) || 'Editor',
            channelUrl: (b.youtube_url as string) || null,
            bio: (b.author_bio as string) || null,
            imageUrl: (b.headshot_url as string) || null,
            jobTitle: 'Product Reviewer',
            knowsAbout: Array.isArray(b.niches) ? (b.niches as string[]).slice(0, 8) : null,
          },
          publisher: {
            name: (b.name as string) || 'MVP Affiliate',
            url: wp.wordpress_url,
            logoUrl: (b.logo_url as string) || null,
            sameAs: [b.youtube_url, b.instagram_url, b.tiktok_url, b.website_url]
              .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
          },
          wordCount: content ? content.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').trim().split(/\s+/).filter(Boolean).length : null,
          category: generated.category || null,
          inLanguage: 'en',
          product: (effectiveAsin || productUrl)
            ? { name: productName, url: productUrl || null, imageUrl: productImage, reviewBody: (generated.excerpt || '').slice(0, 600) }
            : null,
          rating: parseRating(generated.rating),
          thirdPartyProduct: true,
          video: {
            youtubeId: youtubeVideoId,
            name: (vrow.title as string) || generated.title,
            description: ((vrow.description as string) || generated.excerpt || '').slice(0, 500),
            uploadDate: (vrow.published_at as string) || (savedPost?.published_at as string) || new Date().toISOString(),
            thumbnailUrl: ytThumb,
            durationSeconds: (vrow.duration_seconds as number) || null,
          },
          faq: extractFaqFromHtml(content),
          breadcrumb: [
            { name: 'Home', url: wpBaseUrl || wp.wordpress_url },
            ...(generated.category && catSlug ? [{ name: generated.category, url: `${wpBaseUrl}/category/${catSlug}/` }] : []),
            { name: generated.title, url: wpPost.link },
          ],
        })
        await wpService.updatePost(wpPost.id, {
          meta: {
            mvp_jsonld: JSON.stringify(graph),
            mvp_meta_description: ((generated.metaDescription || generated.excerpt) || '').slice(0, 300),
            mvp_og_image: ogImage,
          },
        })
        console.log('[seo-schema] wrote', { postId: wpPost.id, nodes: graph['@graph'].length, og: ogImage === ytThumb ? 'yt' : 'hero' })
      } catch (e) { console.warn('[seo-schema] skipped:', e instanceof Error ? e.message : String(e)) }
    }

    // GUARANTEED early write — runs before anything that can hang.
    await writeSeoMeta(ytThumb, generated.title, initialProductImage)

    // ── Fact-check pass (post-response so the main request never 504s) ───────
    // Strip any product spec/price the transcript + product info don't support,
    // re-publish the corrected text, and use it as the base for images.
    try {
      const checked = await claude.factCheckProductClaims(content, transcript, productResearch, { userId: user.id, tier: (wp?.tier as string) ?? null })
      if (checked && checked !== content) {
        // Re-scrub for voice patterns too — fact-check rewrites can occasionally
        // re-introduce "from what we see in the video" language while editing
        // out a bogus spec.
        content = scrubVoicePatterns(scrubBanned(checked)).content
        try { await wpService.updatePost(wpPost.id, { content }) } catch { /* keep prior text */ }
        if (savedPost?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await (supabase as any).from('blog_posts').update({ content }).eq('id', savedPost.id) } catch { /* non-fatal */ }
        }
      }
    } catch { /* non-fatal — keep the generated text */ }

    let finalContent = content
    // Captured across the image branches; used to upgrade the SEO meta at the end.
    let heroImageUrl: string | null = null
    let schemaProductName = generated.title
    let schemaProductImage: string | null = initialProductImage
    console.log('[blog-images] after() running', { includeImages, userImgs: userImageUrls.length, hasFal: !!process.env.FAL_KEY })

    // ── User-supplied in-article images ───────────────────────────────────
    // When the user uploaded their own images, place THOSE throughout the
    // article (re-hosted on WP for a permanent URL) and skip AI generation.
    if (includeImages && userImageUrls.length > 0) {
      try {
        const uploaded: Array<{ url: string; alt: string }> = []
        for (let i = 0; i < userImageUrls.length; i++) {
          try {
            const media = await wpService.uploadImageFromUrl(userImageUrls[i], `${slug}-body${i + 1}.jpg`)
            if (media?.source_url) uploaded.push({ url: media.source_url, alt: `${altFor(i)}` })
            else uploaded.push({ url: userImageUrls[i], alt: `${altFor(i)}` }) // fallback: embed the public URL directly
          } catch {
            uploaded.push({ url: userImageUrls[i], alt: `${altFor(i)}` })
          }
        }
        heroImageUrl = uploaded[0]?.url ?? heroImageUrl
        if (uploaded.length > 0) {
          const slots = autoPlacementIndices(content, uploaded.length)
          finalContent = insertImagesAtHeadings(
            content,
            uploaded.map((img, i) => ({
              beforeHeadingIndex: slots[i] ?? (i + 1),
              block: gutenbergImageBlock(img.url, img.alt),
            })),
          )
          try { await wpService.updatePost(wpPost.id, { content: finalContent }) } catch { /* keep text-only post */ }
          if (savedPost?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            try { await (supabase as any).from('blog_posts').update({ content: finalContent }).eq('id', savedPost.id) } catch { /* non-fatal */ }
          }
        }
      } catch { /* non-fatal — the published text post stands */ }
    } else if (includeImages) {
      try {
        const falKey = process.env.FAL_KEY
        if (falKey) {
          fal.config({ credentials: falKey })

          // Real video frames (extension) → re-host so we can retouch them. When
          // present, these drive the in-article images (real scene, AI-enhanced)
          // instead of product re-stages.
          const frameRefs: string[] = []
          for (const f of capturedFrames) {
            const u = await rehostToFal(f)
            if (u) frameRefs.push(u)
          }

          // Resolve the REAL product image (uploaded photo → Amazon catalog
          // photo by ASIN) so Kontext renders the actual product.
          let falProductImageUrl: string | null = null
          let productTitleForPrompts = generated.title

          const uploadedProductImage = (v.product_image_url as string | null)?.trim() || null
          if (uploadedProductImage) {
            try {
              const imgRes = await fetch(uploadedProductImage, { headers: { 'User-Agent': 'Mozilla/5.0' } })
              if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
            } catch { /* fall through to Amazon */ }
          }
          if (effectiveAsin) {
            try {
              const p = await fetchAmazonProduct(effectiveAsin)
              if (p.title) { productTitleForPrompts = p.title; schemaProductName = p.title }
              // The Amazon main image is often a multi-panel lifestyle collage;
              // vision-pick the cleanest isolated product shot so Kontext
              // re-renders the ACTUAL product, not a prop from the collage.
              const cleanImg = (await pickProductReferenceImage(p.images, p.title || productTitleForPrompts, { userId: user.id, tier: (wp?.tier as string) ?? null })) || p.imageUrl
              if (cleanImg) schemaProductImage = schemaProductImage || cleanImg
              if (!falProductImageUrl && cleanImg) {
                const imgRes = await fetch(cleanImg, { headers: { 'User-Agent': 'Mozilla/5.0' } })
                if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
              }
            } catch { /* fall back to text-only prompts */ }
          }

          // NON-AMAZON products: pull the real product photo off the store/brand
          // page the creator linked, so Kontext renders the ACTUAL product
          // instead of a text-only guess (the #1 cause of "wrong product"). The
          // Amazon path above already covers ASIN products; this fills the gap.
          if (!falProductImageUrl) {
            let pageUrl = firstProductUrl(rawDescription, wp?.wordpress_url ?? null)
            if (pageUrl && /(?:geni\.us|\bgnz\.|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(pageUrl)) {
              pageUrl = await resolveFinalUrl(pageUrl) // unwrap short/geni.us links to the real page
            }
            if (pageUrl) {
              const productImg = await fetchProductImageFromPage(pageUrl)
              if (productImg) {
                try {
                  const imgRes = await fetch(productImg, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
                  if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
                } catch { /* fall through to text-only prompts */ }
              }
            }
          }

          // Image count scales ~1 per 500 words, clamped to the tier ceiling.
          const words = bodyWordCount(content)
          const imageCount = allowedBlogImages(tier, words)
          const prompts = await generateBodyImagePrompts({
            count: imageCount,
            productTitle: productTitleForPrompts,
            headings: sectionHeadings(content),
            base: generated.imagePrompts,
            ctx: { userId: user.id, tier: (wp?.tier as string) ?? null },
          })

          const tier2 = (wp?.tier as string) ?? null
          let firstImgError: string | null = null
          console.log('[blog-images] generating', { count: prompts.length, falProduct: !!falProductImageUrl })
          const results = await Promise.all(prompts.map(async (prompt, i) => {
            if (!prompt || !prompt.trim()) return null
            const perspective = SHOT_PERSPECTIVES[i % SHOT_PERSPECTIVES.length]
            const seed = Math.floor(Math.random() * 1_000_000_000) + i
            try {
              let falUrl: string | undefined
              // ── Primary: re-render the REAL product photo (resolved from the
              // Amazon / Geniuslink / affiliate link) into a fitting setting.
              // This keeps the ACTUAL product accurate — what readers came to
              // see — instead of guessing from random video frames.
              if (falProductImageUrl) {
                const kontextInstruction = `Re-render the EXACT product shown in this reference image. Keep its precise shape, colour, materials, proportions and any on-product branding identical — never redesign it, swap it, or invent a different product. Remove the original background and any retail packaging. Present this same product as a polished, magazine-quality editorial photo shown as a ${perspective}, placed naturally in a real-world setting that fits how it is actually used: ${prompt}. If a realistic in-use setting doesn't suit it, instead stage the product on a clean surface against a VIBRANT, eye-catching colour-pop / gradient background with soft studio lighting, reflections and depth that make it shine and pop off the page. Realistic shadows and lighting. This must look like a COMPLETELY different photo from the article's other images — a different background and environment, a different surface, different lighting and time of day, and a different camera distance and angle. Do NOT reuse the reference photo's plain studio background or its pose; relocate the product into the new scene. ${NO_BRAND_IMAGE_CLAUSE} Landscape 4:3, photorealistic editorial product photography, no added text.`
                try {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const k = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
                    input: { image_url: falProductImageUrl, prompt: kontextInstruction, aspect_ratio: '4:3', num_images: 1, output_format: 'jpeg', guidance_scale: 5, seed },
                    pollInterval: 3000,
                  })
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  falUrl = ((k.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
                  if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'fal-flux-pro-kontext', images: 1 })
                } catch { /* fall through to frame / text-to-image */ }
              }
              // ── Fallback: no product photo resolved → retouch a real video
              // frame (keeps genuine footage). Secondary because frames don't
              // always cleanly show the product.
              if (!falUrl && frameRefs.length > 0) {
                const frame = frameRefs[i % frameRefs.length]
                const retouchPrompt = `Turn this REAL video frame into a polished, magazine-quality editorial photo for a product-review article. Keep the SAME real people, the SAME product and the SAME scene EXACTLY — do not change anyone's identity, swap the product, or invent anything new. Enhance it: substantially sharpen + add clarity, boost colour vibrancy, saturation and contrast, add bright clean cinematic lighting so the subject pops, and tidy/softly blur the background into a premium look. Frame it as a ${perspective}. REMOVE any burned-in on-screen text, captions, channel names, watermarks or video-player UI. ${NO_BRAND_IMAGE_CLAUSE} Photorealistic, landscape 4:3, no added text.`
                try {
                  const out = await composeWithNanoBanana({ prompt: retouchPrompt, referenceImageUrls: [frame], aspectRatio: '4:3', numImages: 1 })
                  falUrl = out[0]
                  if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'nano-banana', images: 1 })
                } catch { /* fall through to text-to-image */ }
              }
              // ── Last resort: text-to-image (no product photo, no frame). Make
              // it vibrant so the product still pops off the page.
              if (!falUrl) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
                  input: { prompt: `${prompt}. Shown as a ${perspective}. Place the product in a fitting real-world setting, or against a vibrant, eye-catching colour-pop background with soft studio lighting that makes it shine. Editorial product photography, sharp focus, photorealistic, 8K. ${NO_BRAND_IMAGE_CLAUSE} no added text.`, image_size: 'landscape_4_3', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2', seed },
                  pollInterval: 3000,
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                falUrl = ((result.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
                if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'fal-flux-pro-v1.1', images: 1 })
              }
              if (!falUrl) return null
              // HERO ONLY (i === 0): 4x super-resolution for a crisp lead image.
              // AuraSR is cheap (~$0.012) and runs once per post; the rest of
              // the in-body images stay at base resolution to bound cost.
              if (i === 0) {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const up = await fal.subscribe('fal-ai/aura-sr' as any, {
                    input: { image_url: falUrl, checkpoint: 'v2' },
                    pollInterval: 3000,
                  })
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const d = up.data as any
                  const upUrl = (d?.image?.url as string | undefined) || (d?.images?.[0]?.url as string | undefined) || null
                  if (upUrl) {
                    falUrl = upUrl
                    recordUsage({ userId: user.id, tier: tier2, feature: 'blog_hero_upscale', model: 'fal-aura-sr', images: 1 })
                  }
                } catch { /* keep the un-upscaled hero */ }
              }
              const media = await wpService.uploadImageFromUrl(falUrl, `${slug}-body${i + 1}.jpg`)
              return media?.source_url ? { url: media.source_url, alt: `${altFor(i)}` } : null
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              if (!firstImgError) firstImgError = msg
              console.warn(`[blog-images] item ${i} failed:`, msg)
              return null
            }
          }))
          const uploaded = results.filter((r): r is { url: string; alt: string } => !!r)
          heroImageUrl = uploaded[0]?.url ?? heroImageUrl
          console.log('[blog-images] result', { produced: uploaded.length, of: prompts.length, firstError: firstImgError })
          if (uploaded.length === 0) {
            try { await logFailure(supabase, user.id, videoId, 'blog_body_images', `0/${prompts.length} images. falProduct=${!!falProductImageUrl}. firstError=${firstImgError || 'none'}`) } catch { /* non-fatal */ }
          }
          if (uploaded.length > 0) {
            const slots = autoPlacementIndices(content, uploaded.length)
            finalContent = insertImagesAtHeadings(
              content,
              uploaded.map((img, i) => ({
                beforeHeadingIndex: slots[i] ?? (i + 1),
                block: gutenbergImageBlock(img.url, img.alt),
              })),
            )
            // Push the image-enriched body into the live WP post + our DB.
            // updatePost with only `content` leaves the featured image / tags
            // / status untouched (WP REST partial update).
            try { await wpService.updatePost(wpPost.id, { content: finalContent }) } catch { /* keep text-only post */ }
            if (savedPost?.id) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              try { await (supabase as any).from('blog_posts').update({ content: finalContent }).eq('id', savedPost.id) } catch { /* non-fatal */ }
            }
          }
        }
      } catch { /* non-fatal — the published text post stands */ }
    }

    // Upgrade the SEO meta now that images + product have resolved — promote the
    // AI hero to og:image and use the real Amazon product name/image. Skipped
    // when nothing improved over the guaranteed early write. Best-effort.
    if (heroImageUrl || schemaProductName !== generated.title || schemaProductImage !== initialProductImage) {
      await writeSeoMeta(heroImageUrl || ytThumb, schemaProductName, schemaProductImage)
    }

    // Purge the page cache LAST — now content + images + SEO meta are all
    // written — so the JSON-LD/meta render immediately. Uses the same proven
    // path as the dashboard "Purge All" button (re-POST customizations →
    // litespeed_purge_all + wp_cache_flush), WITH auth, so it purges even on a
    // site with no customizations saved. Best-effort.
    await wpService.purgeCache((wp as Record<string, unknown> | null)?.blog_customizations)
  })

  return NextResponse.json({
    success: true,
    postId: savedPost?.id,
    wordpressPostId: wpPost.id,
    wordpressUrl: wpPost.link,
    title: generated.title,
    productUrl,
    hasImages: includeImages,
  })
}

async function logFailure(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
  videoId: string,
  jobType: 'blog_generation' | 'wp_publish' | 'blog_body_images',
  errorMessage: string,
) {
  await supabase.from('job_failures').insert({
    user_id: userId,
    video_id: videoId,
    job_type: jobType,
    error_message: errorMessage,
    retry_count: 0,
    status: 'pending_retry',
  })
}

/** Pull the shortcode out of a Geniuslink URL embedded in text.
 *  e.g. "https://geni.us/y2ClyW" -> "y2ClyW". Returns null if not found. */
function extractGeniuslinkCode(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)
  return m ? m[1] : null
}
