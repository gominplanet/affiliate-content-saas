import { NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit, checkGenerationLimit, TIERS, nextTierFor, allowedBlogImages, normalizeTier, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { scrubBanned } from '@/lib/scrub'
import { scrubAiHtml } from '@/lib/html-scrub'
import { scrubVoicePatterns } from '@/lib/blog-voice-scrub'
import { selfCheckBlogPost, selfCritiqueBlogPost } from '@/lib/blog-self-check'
import { discoverProductForVideo } from '@/lib/product-detect'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { resolveGeniuslinkGroupId, appendAmazonSubtag, groupNameForSiteUrl } from '@/lib/geniuslink-group'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { verifyProductMatch } from '@/lib/product-image'
import { researchProductFromUrl, researchProductByWebSearch } from '@/services/research'
import { resolveProductReference } from '@/lib/resolve-product-reference'
import { researchKeyword } from '@/lib/keyword-research'
import { getValidGscToken, querySearchAnalytics } from '@/lib/gsc'
import { maybeEvolveLearnProfile } from '@/lib/learn-evolve'
import { maybeDistillFeedback } from '@/lib/feedback-distill'
import { maybeLearnFromEdits } from '@/lib/edit-learning'
import { gutenbergImageBlock, pickBodyImageOffsets, insertImagesAtOffsets } from '@/lib/blog-body-images'
import { composeWithNanoBanana, rehostToFal } from '@/lib/thumbnail-generators'
import { fetchStoryboardFrames } from '@/lib/youtube-storyboards'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { pickRelatedPosts, renderRelatedLinksBlock, insertRelatedLinks, type LinkCandidate } from '@/lib/internal-links'
import { injectPriceStrip } from '@/lib/price-strip'
import { buildReviewSchemaGraph, parseRating, extractFaqFromHtml } from '@/lib/seo-schema'
import { fal } from '@fal-ai/client'
import { recordUsage } from '@/lib/ai-usage'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { SHOT_PERSPECTIVES, sectionHeadings, generateBodyImagePrompts } from '@/lib/blog-image-prompts'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

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
  // 2026-06-09 Phase 2: resolve the effective owner so a VA's generation
  // reads + writes under the OWNER's user_id (their workspace), while
  // usage caps + generation tracking still bill the caller (the VA).
  // For account owners, ownerId === user.id and behavior is unchanged.
  //
  // 2026-06-09 Phase 4: the generation-job worker invokes this route
  // INTERNALLY (off the user's request) carrying the shared secret + the job's
  // identity in headers. In that service mode we authenticate via the
  // service-role client + the header identity instead of a cookie session.
  // Everything downstream is byte-identical — queries are already scoped by
  // ownerId and caps are billed to user.id — so the whole handler is reused
  // for both the synchronous request and the async worker, with zero
  // duplication of the generation logic.
  const svcSecret = request.headers.get('x-mvp-service')
  const isServiceCall = !!svcSecret && svcSecret === process.env.CRON_SECRET

  let supabase: Awaited<ReturnType<typeof createServerClient>>
  let user: { id: string }
  let ownerId: string
  if (isServiceCall) {
    const svcUser = request.headers.get('x-mvp-service-user') || ''
    if (!svcUser) return NextResponse.json({ error: 'Service call missing identity' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase = createAdminClient() as unknown as Awaited<ReturnType<typeof createServerClient>>
    user = { id: svcUser }
    ownerId = request.headers.get('x-mvp-service-owner') || svcUser
  } else {
    supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    user = auth.user
    ownerId = auth.ownerId
  }

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
    /** Power-user escape hatch for the no-transcript gate. When true and the
     *  transcript fetch yields nothing, we proceed with empty transcript instead
     *  of returning 422. The article quality will be lower (no lived experiences
     *  to ground on), but it's there if the user really wants to force it. */
    allowEmptyTranscript?: boolean
    /** Multi-site (Pro): UUID of the wordpress_sites row to publish this post
     *  to. Omit / null → the user's default site (same behaviour as before
     *  multi-site existed). Single-site users never send this. */
    siteId?: string | null
    /** Schedule mode — when present, the post is GENERATED now but its WP
     *  status is NOT 'publish'. See lib/schedule-types.ts for the two modes.
     *    - 'wp-native' → WP gets status=future + post_date=scheduledFor.
     *      WordPress's own cron flips it to publish.
     *    - 'draft-flip' → WP gets status=draft. Our cron flips it later.
     *  Either mode requires `scheduledFor`. Omitted entirely → immediate
     *  publish, same as always. */
    scheduleMode?: 'wp-native' | 'draft-flip'
    /** ISO 8601 timestamp the post should go live. Required when
     *  scheduleMode is set. */
    scheduledFor?: string
  }
  const { videoId, rewriteFeedback, allowEmptyTranscript, siteId } = body
  const scheduleMode = body.scheduleMode
  const scheduledForIso = body.scheduledFor

  // Validate scheduling input early — bad input is an immediate 400.
  if (scheduleMode && !scheduledForIso) {
    return NextResponse.json(
      { error: 'scheduledFor is required when scheduleMode is set' },
      { status: 400 },
    )
  }
  if (scheduleMode && !['wp-native', 'draft-flip'].includes(scheduleMode)) {
    return NextResponse.json(
      { error: `scheduleMode must be 'wp-native' or 'draft-flip' (got ${scheduleMode})` },
      { status: 400 },
    )
  }
  if (scheduledForIso) {
    const t = new Date(scheduledForIso).getTime()
    if (isNaN(t)) {
      return NextResponse.json({ error: 'scheduledFor is not a valid ISO timestamp' }, { status: 400 })
    }
    if (t <= Date.now() + 60_000) {
      return NextResponse.json(
        { error: 'scheduledFor must be at least 1 minute in the future' },
        { status: 400 },
      )
    }
  }
  // Resolve the effective WP status. Default 'publish' (current behaviour).
  // wp-native scheduling carries the date through. draft-flip leaves date
  // unset — the post sits as a plain draft until our cron flips it.
  const wpStatus: 'publish' | 'future' | 'draft' =
    scheduleMode === 'wp-native' ? 'future' :
    scheduleMode === 'draft-flip' ? 'draft' :
    'publish'
  const isScheduled = scheduleMode !== undefined
  // OPT-IN (2026-06-12 cost control): images only when the caller EXPLICITLY
  // asks. Was `!== false` (default ON when omitted), which meant rewrites,
  // retries, and any caller that didn't send the field silently generated a
  // full set of fal images every time. The Content page's "Include photos"
  // box sends the explicit choice; the SEO rebuild sends includeImages:true.
  const includeImages = body.includeImages === true
  const userImageUrls = Array.isArray(body.userImageUrls)
    ? body.userImageUrls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 3)
    : []
  // `capturedFrames` are HD video frames the in-article images get retouched
  // FROM. They used to come from a Chrome extension that opened a YouTube tab
  // in the background to scrub frames — which the user kept noticing. The
  // server now fetches storyboard tiles from YouTube directly (no tabs, no
  // extension) via lib/youtube-storyboards as the default source; the body
  // field is kept for forward compatibility / admin retries that still want to
  // pass their own frames.
  let capturedFrames = Array.isArray(body.capturedFrames)
    ? body.capturedFrames.filter(f => typeof f === 'string' && f.startsWith('data:image/')).slice(0, 4)
    : []
  if (!videoId) return NextResponse.json({ error: 'videoId is required' }, { status: 400 })

  // ── Detect rewrite vs fresh generation ────────────────────────────────────
  // We also pull wordpress_post_id + slug here so the WP push below can UPDATE
  // an existing live post (legacy posts attached via /api/blog/attach-video,
  // or any prior generate run) instead of creating a duplicate that fights the
  // old one for the same slug.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingForLimit } = await supabase
    .from('blog_posts')
    .select('id, rewrite_count, wordpress_post_id, slug, wordpress_site_id, wordpress_url')
    .eq('user_id', ownerId)
    .eq('video_id', videoId)
    .limit(1)
    .maybeSingle()

  const isRewrite = !!existingForLimit
  // When set: skip createPost and updatePost(existingWpPostId) instead, so the
  // live URL + Google indexing history are preserved across the rebuild.
  let existingWpPostId: number | null = existingForLimit?.wordpress_post_id ?? null
  const existingSlug: string | null = existingForLimit?.slug ?? null
  // Multi-site: if this is a rewrite and the existing post is tied to a
  // specific wordpress_sites row, ROUTE THE REGENERATE TO THE SAME SITE
  // regardless of which is currently default. Without this, a /content
  // "Generate post" click on a Wine-blog post would re-publish to Main
  // because that's the current default. body.siteId still wins when the
  // caller explicitly picks a different site (we trust the caller's intent).
  const existingSiteId: string | null =
    (existingForLimit as { wordpress_site_id?: string | null } | null)?.wordpress_site_id ?? null

  // ── Monthly AI-spend circuit breaker ───────────────────────────────────────
  // Hard dollar backstop on top of the per-feature caps. Trips when the account
  // has burned more than its tier's `monthlyAiSpendCeilingUsd` in real AI cost
  // this calendar month — catching runaway loops and uncapped admin testing
  // (the overnight-$60 case) that the postsPerMonth caps can't, since admin is
  // unlimited there. Skipped for the worker self-call: that job already passed
  // this gate at enqueue, and we don't want a half-finished queue to wedge.
  // Fails open on any telemetry error (checkSpendCeiling returns allowed=true).
  if (!isServiceCall) {
    const { data: spendTierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', ownerId)
      .maybeSingle()
    const gate = await spendGate(ownerId, spendTierRow?.tier)
    if (gate) return gate
  }

  if (isServiceCall) {
    // Queued async job (Phase 4 increment C). The interactive gates do NOT apply:
    // the Generations quota was consumed ONCE at enqueue (not per worker attempt),
    // and a retry that finds an existing row must UPDATE it in place (the isRewrite
    // logic above already set existingWpPostId, preserving the live URL) rather
    // than 403 as a user-initiated "rewrite". Skip both gates.
  } else if (isRewrite) {
    // ── Rewrite gate (Pro-only, once per post) ──────────────────────────────
    // Manual editing in WordPress is always available; this gate stops the
    // expensive AI rewrite path from being triggered by non-Pro tiers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', ownerId)
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
    // Fresh generation — gate against the unified Generations cap that
    // bundles blog + thumbnail + metadata into one bucket per billing
    // period (migration 101). Trial users still hit the lifetime gate
    // first via checkUsageLimit; paid tiers go straight through the
    // unified RPC.
    const trialUsage = await checkUsageLimit(supabase, user.id)
    if (!trialUsage.allowed) {
      return NextResponse.json({
        error: trialUsage.reason,
        limitReached: true,
        cap: 'posts',
        currentTier: trialUsage.tier,
        upgrade: trialUsage.upgrade,
      }, { status: 403 })
    }
    const usage = await checkGenerationLimit(supabase, user.id)
    if (!usage.allowed) {
      return NextResponse.json({
        error: usage.reason,
        limitReached: true,
        cap: 'generations',
        currentTier: usage.tier,
        upgrade: usage.upgrade,
      }, { status: 403 })
    }
  }
  // Hide-warning for unused references — used below for the prompt.
  void TIERS

  // ── 1-3. Fetch video + brand + integration in parallel ──────────────────
  // Perf (audit 2026-06-02): these three reads were sequential and
  // each ~150-250ms — 600ms wasted before the AI call could even
  // start. They're fully independent (different tables, different
  // PKs), so Promise.all is safe.
  const [
    { data: video, error: videoErr },
    { data: brand },
    { data: integration },
  ] = await Promise.all([
    supabase.from('youtube_videos').select('*').eq('user_id', ownerId).eq('id', videoId).maybeSingle(),
    supabase.from('brand_profiles').select('*').eq('user_id', ownerId).maybeSingle(),
    supabase.from('integrations').select('*').eq('user_id', ownerId).maybeSingle(),
  ])

  if (videoErr || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  if (!brand) {
    return NextResponse.json(
      { error: 'Brand profile not set up. Complete your brand profile first.' },
      { status: 400 },
    )
  }

  const wp = integration as Record<string, string> | null
  // Function-scope tier (the rewrite gate above has its own narrow copy).
  // Drives the per-tier in-body image ceiling via allowedBlogImages.
  const tier = normalizeTier(wp?.tier)
  // Multi-site: resolve which WordPress site this generation publishes to.
  // Priority order:
  //   1. body.siteId — caller explicitly picked a site (UI dropdown).
  //   2. existingSiteId — REWRITE of an existing post → stay on that site.
  //   3. default site — fresh generation, no preference.
  // The helper falls back to legacy integrations.wordpress_* if
  // wordpress_sites hasn't been backfilled yet, so single-site users see
  // no behaviour change.
  const effectiveSiteId = siteId ?? existingSiteId
  const site = await getWordPressCredentials(supabase, ownerId, effectiveSiteId)
  if (!site) {
    return NextResponse.json(
      { error: 'WordPress not connected. Add your WordPress credentials in Settings.' },
      { status: 400 },
    )
  }

  // ── 4. Fetch transcript ───────────────────────────────────────────────────
  // Layered: cached on the row → YouTube Data API (official, force-ssl scope
  // the user already granted) → YoutubeTranscript scraper as last resort.
  // The Data API is the most reliable for caption tracks the creator uploaded
  // themselves; the scraper picks up auto-captions YouTube generates (which
  // the Data API often refuses to download). transcriptSource is reported
  // back to the client so the UI can show what we used.
  // Pull the cached transcript + ID off the row. We type-narrow with
  // Record<string, unknown> rather than the strict typed row because
  // the column list here is dynamic (different code paths select
  // different subsets of `youtube_videos`).
  const videoRow = video as Record<string, unknown>
  let transcript = (videoRow.transcript as string | null) || ''
  let transcriptSource: 'cache' | 'youtube_api' | 'scraper' | 'none' = transcript ? 'cache' : 'none'
  const youtubeVideoIdForTranscript = (videoRow.youtube_video_id as string | undefined) ?? ''

  // Layer 1: official YouTube Data API.
  // Perf (audit 2026-06-02): reuses the `integration` row already
  // loaded in the Promise.all above — was previously re-fetching
  // the same row a second time (~80ms saved).
  if (!transcript && youtubeVideoIdForTranscript) {
    try {
      const integ = integration as Record<string, unknown> | null
      if (integ?.youtube_oauth_access_token) {
        const token = await getValidYouTubeToken(integ as Record<string, unknown>)
        const yt = createYouTubeOAuthService(token)
        const apiTranscript = await yt.getTranscript(youtubeVideoIdForTranscript)
        if (apiTranscript && apiTranscript.trim().length >= 40) {
          transcript = apiTranscript
          transcriptSource = 'youtube_api'
        }
      }
    } catch { /* fall through to the scraper */ }
  }

  // Layer 2: YoutubeTranscript scraper (handles auto-captions but YouTube
  // blocks it from many cloud IPs — best-effort).
  if (!transcript && youtubeVideoIdForTranscript) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(youtubeVideoIdForTranscript, { lang: 'en' })
      const text = segments.map((s: { text: string }) => s.text).join(' ')
      if (text && text.trim().length >= 40) {
        transcript = text
        transcriptSource = 'scraper'
      }
    } catch { /* leave empty */ }
  }

  // Cache whatever we got so the next regen / rewrite is instant.
  if (transcript && transcriptSource !== 'cache') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase
        .from('youtube_videos')
        .update({ transcript, transcript_fetched_at: new Date().toISOString() })
        .eq('id', videoId)
    } catch { /* non-fatal */ }
  }

  // NOTE: no standalone empty-transcript gate here — the layered fetcher above
  // already tries the official Data API before the scraper, and the voice-
  // betrayal scrub + prompt rule 8 keep "we don't have a transcript" patterns
  // out of the body. The REVIEW-WORTHINESS gate below (§5.2) refuses only the
  // truly contentless case: no resolvable product AND a thin transcript.
  // allowEmptyTranscript is that gate's explicit "generate anyway" override.
  const transcriptUsed = !!transcript && transcript.trim().length >= 80

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
    const directProductUrl = firstProductUrl(rawDescription, site.wordpress_url ?? null)
    if (directProductUrl) {
      if (/(?:geni\.us|\bgnz\.)/i.test(directProductUrl)) {
        // Geniuslink found in the description. Two paths:
        //
        // (a) User has their own Geniuslink keys connected. UNWRAP it to
        //     the underlying destination so we can RE-WRAP under the
        //     per-site group. Critical for tracking: the existing
        //     geni.us link likely came from MVP's YouTube Co-Pilot
        //     (MVP-YOUTUBE group) — reusing it on the blog would lump
        //     blog clicks into the YouTube bucket and defeat per-source
        //     attribution. Unwrapping + re-wrapping creates a NEW link
        //     in the site's own group with the same final destination.
        //
        // (b) No Geniuslink keys connected. Can't re-wrap, so keep as-is
        //     (still drives traffic to the product, just no MVP routing).
        if (wp?.geniuslink_api_key && wp?.geniuslink_api_secret) {
          const finalUrl = await resolveTrueDestination(directProductUrl)
          const asinFromFinal = finalUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]
          if (asinFromFinal) {
            asinOverride = asinFromFinal.toUpperCase()
            destination = `https://www.amazon.com/dp/${asinOverride}`
          } else {
            // Geniuslink resolved to a non-Amazon URL — use that as the
            // raw destination so the new wrapper still points to the
            // same product.
            destination = finalUrl
          }
        } else {
          destination = directProductUrl
          alreadyGeniuslink = true
        }
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
    // 2026-06-09: TRACKING ENHANCEMENT
    //   1. Per-blog grouping — resolve (and auto-create) a Geniuslink group
    //      named after the site's domain so the user's dashboard shows
    //      clicks segmented by blog instead of all jumbled into "YouTube
    //      Links". Cached on wordpress_sites.geniuslink_group_id.
    //   2. Per-post Amazon attribution — append ascsubtag={videoId} so the
    //      user sees EARNINGS broken down per video in the Amazon
    //      Associates Tracking Report. Rides through the Geniuslink
    //      redirect; safe no-op on non-Amazon destinations.
    //   3. Richer Geniuslink note ("{videoId} | {domain}") so the
    //      dashboard's link list is filterable per post.
    const linkVideoId = youtubeVideoIdForTranscript || null
    const linkDomain = groupNameForSiteUrl(site.wordpress_url || '') || ''
    const linkNote = linkVideoId && linkDomain
      ? `${linkVideoId} | ${linkDomain}`
      : (linkVideoId || rawTitle)
    const destinationWithSubtag = appendAmazonSubtag(destination, linkVideoId)

    if (alreadyGeniuslink) {
      affiliateUrlOverride = destination
    } else if (wp?.geniuslink_api_key && wp?.geniuslink_api_secret) {
      // Resolve the per-site group (creates it on first use, caches the
      // ID on the row).
      //
      // 2026-06-09 BUG FIX: was using `effectiveSiteId` here, which is
      // null on fresh generations where the caller didn't pick a site
      // in the UI. Result: the resolver was skipped, groupId stayed
      // null, the wrap call fell back to getDefaultGroupId() which
      // matches /youtube/i and returns MVP-YOUTUBE. Every blog link
      // landed in the YouTube bucket. Use `site.site_id` instead —
      // `getWordPressCredentials` always returns a non-null site, so
      // its id is reliable. Skip resolution only for 'legacy' (pre-
      // multi-site users with no wordpress_sites row).
      const resolvedSiteId = site.site_id !== 'legacy' ? site.site_id : null
      const groupId = resolvedSiteId
        ? await resolveGeniuslinkGroupId({
            supabase,
            siteId: resolvedSiteId,
            siteUrl: site.wordpress_url,
            apiKey: wp.geniuslink_api_key,
            apiSecret: wp.geniuslink_api_secret,
          })
        : null
      try {
        const genius = createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
        const wrapped = await genius.createLink(destinationWithSubtag, rawTitle, {
          groupId: groupId ?? undefined,
          note: linkNote,
        })
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
            ? appendAmazonSubtag(`https://www.amazon.com/dp/${asinOverride}?tag=${wp.amazon_associates_tag}`, linkVideoId)
            : destinationWithSubtag
        }
      } catch {
        affiliateUrlOverride = destinationWithSubtag
      }
    } else if (asinOverride && wp?.amazon_associates_tag) {
      affiliateUrlOverride = appendAmazonSubtag(`https://www.amazon.com/dp/${asinOverride}?tag=${wp.amazon_associates_tag}`, linkVideoId)
    } else {
      affiliateUrlOverride = destinationWithSubtag
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
    await supabase.from('youtube_videos').update({ product_url: productUrl }).eq('id', videoId)
  }

  // ── 5.2. Review-worthiness gate ────────────────────────────────────────────
  // A review needs SOMETHING to ground on: a resolved product (link/ASIN) or
  // real spoken content. Short clips with neither (one-word title, no
  // description link) used to sail through and publish 2,000 scrupulously
  // honest words of "the clip doesn't say" — no affiliate link to earn with,
  // and thin content that drags the whole site's rankings (the
  // lizonajourney.com hair-straightener case, 2026-06-11). Refuse HERE, before
  // the research + writer spend. The same check protects rebuilds: rebuilding
  // one of these without first attaching a product would reproduce the same
  // empty post. allowEmptyTranscript is the explicit "generate anyway"
  // override from the UI confirm — the user keeps the final say.
  if (!productUrl && (transcript || '').trim().length < 500 && !allowEmptyTranscript) {
    return NextResponse.json({
      error: 'This looks like a short clip with no product attached — no Amazon or product link in the video\'s title or description, and not enough spoken content to ground a review. Add the product link to the first lines of the video\'s YouTube description, then try again — or generate anyway to publish a general post without an affiliate link.',
      reason: 'not_reviewable',
    }, { status: 422 })
  }

  // ── Persistent feedback: every "what was missing" note this user
  // has ever typed into the Rewrite modal. These accumulate over time
  // and apply to every new generation — the AI keeps learning what
  // this user actually wants.
  //
  // Sprint 3 (2026-06-09): prefer the DISTILLED feedback when available.
  // lib/feedback-distill.ts collapses the raw notes into a deduplicated,
  // weighted rule set cached on brand_profiles.distilled_feedback — so
  // "make the intro shorter" × 5 becomes ONE strong rule instead of 5
  // redundant lines. Falls back to the raw notes when no distilled cache
  // exists yet (new users, or pre-migration). The distilled text is a
  // bullet list; split it into lines (stripping the "- " prefix) so it
  // renders cleanly as the numbered standing-feedback list downstream.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const distilledFeedbackRaw = ((brand as Record<string, unknown> | null)?.distilled_feedback as string | null | undefined)?.trim() || ''
  let persistentFeedback: string[]
  if (distilledFeedbackRaw) {
    persistentFeedback = distilledFeedbackRaw
      .split('\n')
      .map(l => l.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(s => s.length > 0)
      .slice(0, 10)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: feedbackRows } = await supabase
      .from('blog_posts')
      .select('last_rewrite_feedback,published_at')
      .eq('user_id', ownerId)
      .not('last_rewrite_feedback', 'is', null)
      .order('published_at', { ascending: false })
      .limit(8)
    persistentFeedback = (feedbackRows as Array<{ last_rewrite_feedback: string | null }> | null)
      ?.map(r => (r.last_rewrite_feedback || '').trim())
      .filter(s => s.length > 0)
      .slice(0, 8) ?? []
  }

  // Sprint 3 Part 2: fold in the IMPLICIT edit-pattern rules learned from the
  // diff between our drafts and the creator's edited WordPress versions
  // (lib/edit-learning.ts → brand_profiles.edit_pattern_feedback). Same bullet
  // format as distilled_feedback; appended so BOTH the explicit Rewrite notes
  // and the implicit edit signal shape every new draft. Capped so it stays tight.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editPatternRaw = ((brand as Record<string, unknown> | null)?.edit_pattern_feedback as string | null | undefined)?.trim() || ''
  if (editPatternRaw) {
    const editRules = editPatternRaw
      .split('\n')
      .map(l => l.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(s => s.length > 0)
      .slice(0, 6)
    persistentFeedback = [...persistentFeedback, ...editRules].slice(0, 14)
  }

  // ── Voice anchors: pull the user's 2 most-recently-published posts
  // so Claude can match their voice on every new generation. This is
  // the feedback loop — the more they ship, the more "them" each new
  // draft sounds. Excluded: the post being rewritten (would self-
  // mirror) and posts without content. Shortened to ~1200 chars each
  // to keep the prompt budget reasonable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorRows } = await supabase
    .from('blog_posts')
    .select('title,content,video_id')
    .eq('user_id', ownerId)
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
  const { data: linkRows } = await supabase
    .from('blog_posts')
    .select('title,wordpress_url,seo_keyword,post_type,content')
    .eq('user_id', ownerId)
    .eq('status', 'published')
    .neq('video_id', videoId)
    .not('wordpress_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20)
  // Include a stripped content snippet + post_type so the topical matcher has
  // body-text and type signal to score on, not just title overlap (which is
  // too narrow when many posts have no seo_keyword and short titles).
  const stripSnippet = (html: string | null | undefined): string => {
    if (!html) return ''
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
  }
  const linkCandidates: LinkCandidate[] = (linkRows as Array<{ title: string; wordpress_url: string; seo_keyword: string | null; post_type: string | null; content: string | null }> | null)
    ?.filter(r => r.title && r.wordpress_url)
    .map(r => ({
      title: r.title,
      url: r.wordpress_url,
      keyword: r.seo_keyword,
      contentSnippet: stripSnippet(r.content),
      postType: r.post_type || undefined,
    })) ?? []

  // ── 5.9. Web product research — scrape the product/brand site the
  //         creator linked in the description for factual product info,
  //         the open-web equivalent of an Amazon scrape. The transcript
  //         still drives the voice; this just gives the writer real
  //         product facts. Creator/Pro/Admin (not Trial); best-effort.
  //
  //  COST (2026-06-12): SKIP this entirely for Amazon products. When we have an
  //  ASIN, §5.95 below already does ONE fetchAmazonProduct() and feeds the
  //  authoritative listing (title + bullets) to the writer — so the web search
  //  here was redundant AND expensive (it was the $28/mo, ~36k-input-tokens/call
  //  `blog_web_product_search` line). Only run it for NON-Amazon products
  //  (direct-store links) where we have no listing to fall back on.
  let productResearch: string | null = null
  if (!asinOverride && (tier === 'creator' || tier === 'pro' || tier === 'admin')) {
    const pUrl = firstProductUrl(rawDescription, site.wordpress_url ?? null)
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

  // ── 5.95. Keyword research (Phase 2 — FREE). The Amazon seller already did
  //          the keyword research for us: the listing TITLE is packed with the
  //          highest-converting buyer search terms (strongest signal), the
  //          "about this item" bullets second. Mine those + validate real
  //          demand with FREE Amazon + Google autocomplete, and hand the writer
  //          a researched target keyword instead of letting it guess. Best-
  //          effort + time-boxed; on any failure the model derives its own
  //          keyword (prior behavior) so generation never blocks. No paid APIs,
  //          no user accounts (see lib/keyword-research.ts).
  let targetKeyword: string | null = null
  let supportingKeywords: string[] = []
  if (asinOverride) {
    // ONE Amazon fetch, two jobs: (a) the AUTHORITATIVE product identity + specs
    // for the writer — the listing TITLE carries the real brand and the bullets
    // carry real specs; (b) the keyword-research seed. Best-effort + time-boxed;
    // on any failure we fall back to prior behavior (model derives everything).
    const amazonStep = await withTimeout(
      (async () => {
        const product = await fetchAmazonProduct(asinOverride!).catch(() => null)
        if (!product?.title) return null
        const research = await researchKeyword({
          amazonTitle: product.title,
          amazonBullets: product.bullets,
          videoTitle: rawTitle,
          brandName: (brand as Record<string, unknown>).name as string | undefined,
        }).catch(() => null)
        return { product, research }
      })(),
      15000,
      null,
    )
    if (amazonStep?.product?.title) {
      // Hand the writer the seller's listing as GROUND TRUTH for the product's
      // brand + specs. This is what stops the writer inventing a brand from a
      // generic transcript/web phrase (e.g. titling a PURRUGS mat "Muddy Mat").
      // It's the user's Amazon-listing rule applied to the BODY, not just the
      // keyword. Prepended so it leads the product info the writer reads — and
      // the title fact-check (§5.6) reads the same productResearch, so it gains
      // the real brand too.
      const a = amazonStep.product
      const amazonFacts = [
        'AUTHORITATIVE PRODUCT LISTING (Amazon) — the exact item the affiliate link sells. Use THIS for the product\'s real brand + name; it overrides any generic descriptor the creator used on camera.',
        `Title: ${a.title}`,
        a.bullets.length ? `About this item:\n${a.bullets.map((b) => `- ${b}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')
      productResearch = productResearch ? `${amazonFacts}\n\n${productResearch}` : amazonFacts
    }
    if (amazonStep?.research?.primary) {
      targetKeyword = amazonStep.research.primary
      supportingKeywords = amazonStep.research.supporting
      console.log('[blog/generate] keyword research', { primary: targetKeyword, supporting: supportingKeywords })
    }
  }

  // ── 5.97. GSC feedback loop (Phase 3 — rebuilds only). When this video
  //          already has a LIVE post, Google Search Console knows the exact
  //          queries it ranks for. Feed the top ones back into the rewrite so
  //          striking-distance queries (pos 4-20) get worked into subheads/
  //          FAQs — the cheapest page-2 → page-1 push there is. Best-effort +
  //          time-boxed: any failure (GSC not connected, no data yet, slow
  //          API) silently degrades to the Phase-2-only behavior.
  let gscQueries: Array<{ query: string; position: number; impressions: number }> = []
  const livePostUrl = (existingForLimit as { wordpress_url?: string | null } | null)?.wordpress_url || null
  if (isRewrite && livePostUrl) {
    gscQueries = await withTimeout(
      (async () => {
        const { data: gscRow } = await supabase
          .from('integrations').select('gsc_property').eq('user_id', ownerId).maybeSingle()
        const property = (gscRow as { gsc_property?: string | null } | null)?.gsc_property
        if (!property) return []
        const token = await getValidGscToken(supabase, ownerId)
        if (!token) return []
        const end = new Date(); end.setDate(end.getDate() - 3)   // GSC ~3-day lag
        const start = new Date(); start.setDate(start.getDate() - 31)
        const ymd = (d: Date) => d.toISOString().slice(0, 10)
        const rows = await querySearchAnalytics(token, property, {
          startDate: ymd(start), endDate: ymd(end), dimensions: ['query'], page: livePostUrl, rowLimit: 25,
        })
        return rows
          .filter(r => (r.impressions ?? 0) >= 3 && r.keys?.[0])
          .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
          .slice(0, 8)
          .map(r => ({
            query: String(r.keys![0]),
            position: Math.round((r.position ?? 0) * 10) / 10,
            impressions: Math.round(r.impressions ?? 0),
          }))
      })(),
      8000,
      [] as Array<{ query: string; position: number; impressions: number }>,
    )
    if (gscQueries.length) {
      console.log('[blog/generate] gsc rebuild targeting', { post: existingForLimit?.id, queries: gscQueries.map(q => q.query) })
      // Populate the (previously dormant) post_seo.top_queries cache so the
      // SEO dashboard can show the same data without another GSC call.
      try {
        await supabase.from('post_seo').upsert({
          post_id: existingForLimit!.id,
          user_id: ownerId,
          top_queries: gscQueries,
        }, { onConflict: 'post_id' })
      } catch { /* non-fatal */ }
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
        // 2026-06-08 (#14): opt-in "What we'd improve" section. Read from
        // brand_profiles.include_improvements_section (migration 110).
        // Falls back to false when the column is missing so the toggle is
        // opt-in by default.
        include_improvements_section: !!(brand as Record<string, unknown>).include_improvements_section,
        // 2026-06-09: per-brand section toggles (migration 111). Each
        // defaults to true when the column is missing OR when the value
        // is explicitly true — only an explicit false disables the section.
        // This preserves existing behavior for users who haven't yet
        // opted any sections out.
        include_quick_verdict: (brand as Record<string, unknown>).include_quick_verdict !== false,
        include_pros_cons:     (brand as Record<string, unknown>).include_pros_cons !== false,
        include_scorecard:     (brand as Record<string, unknown>).include_scorecard !== false,
        include_faq:           (brand as Record<string, unknown>).include_faq !== false,
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
        targetKeyword,
        supportingKeywords,
        gscQueries,
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
    // act on instead of a cryptic one-word error. Also catches bare
    // "Internal Server Error" / HTTP 500 surfaces from upstream APIs
    // (Amazon scraper, WP REST, etc.) — those are almost always transient
    // and a retry usually works.
    const transient = /terminated|fetch failed|socket|ECONNRESET|aborted|network|timeout|overloaded|internal server error|^\s*5\d{2}\s*$|52\d|50[023]/i.test(rawMsg)
    const msg = transient
      ? 'A network step in generation timed out or returned an error (usually Amazon scrape, Claude, or WordPress). This is almost always temporary — hit Retry. Raw: ' + rawMsg.slice(0, 120)
      : rawMsg
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // ── 5.5. Hard-enforce the banned-word rule on every user-facing field.
  //         LLM instructions aren't a guarantee; this is the last line of
  //         defense before anything is published or persisted.
  generated.title = scrubBanned(generated.title)
  generated.excerpt = scrubBanned(generated.excerpt)
  // scrubAiHtml: strip ```html fence if Sonnet wrapped + replace every
  // em-dash with a comma. The user's hard rule, enforced at the
  // application boundary so it can't slip through the prompt.
  generated.content = scrubAiHtml(scrubBanned(generated.content))
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
    const channelUrl = ((brand as Record<string, unknown> | null)?.youtube_channel_url as string | null) ?? null
    const scrub = scrubVoicePatterns(content, { channelUrl })
    content = scrub.content
    if (scrub.paragraphsRemoved + scrub.phrasesRewritten + scrub.handlesWrapped > 0) {
      console.log(`[blog/generate] voice scrub: dropped ${scrub.paragraphsRemoved} paragraph(s), rewrote ${scrub.phrasesRewritten} phrase(s), wrapped ${scrub.handlesWrapped} @handle(s)`)
    }
  }

  // Haiku self-check pass — last line of defence against catalogue-level
  // style tics that slip past the writing-time prompt: "nobody talks about",
  // "small thing but matters", "I don't throw that word around lightly",
  // "like genuinely ___" compounds, em-dash in headings, conclusion
  // crescendos, "Some users…" hedges. Costs ~$0.001/post; ships the
  // original content unchanged on any failure (defensive — this is polish,
  // not a hard gate).
  try {
    const selfCheck = await selfCheckBlogPost({
      content,
      productTitle: generated.title || '',
      ctx: { userId: user.id, tier: (wp?.tier as string) ?? null },
    })
    if (selfCheck.fixesApplied > 0) {
      console.log(`[blog/generate] self-check: applied ${selfCheck.fixesApplied}/${selfCheck.violations.length} fixes`,
        selfCheck.violations.map(v => ({ pattern: v.pattern, applied: v.applied })))
      content = selfCheck.content
    } else if (selfCheck.violations.length > 0) {
      // Haiku flagged violations but none of the `original` strings
      // matched verbatim — log so we can see what's drifting. Most
      // common cause: Haiku paraphrased the original instead of
      // copying the exact sentence.
      console.log(`[blog/generate] self-check: ${selfCheck.violations.length} flagged but 0 applied (paraphrase mismatch)`)
    }
    // RULE 11 directional signal: warn when the post ships with fewer
    // than 3 product-specific numbers. Doesn't block publish — some
    // transcripts genuinely lack measurable specs — but lets us spot
    // posts where the model didn't bother to surface what was there.
    if (selfCheck.numbersDetected < 3) {
      console.warn(`[blog/generate] self-check: only ${selfCheck.numbersDetected} product-specific number(s) in post (RULE 11 target = 3). Either transcript lacked specs or model didn't surface them.`)
    } else {
      console.log(`[blog/generate] self-check: ${selfCheck.numbersDetected} product-specific numbers detected`)
    }
    // Persist the check results for /admin/blog-quality so trends are
    // visible across the catalogue. Best-effort write — a failed insert
    // never blocks the post. Uses admin client because the table's
    // user-context insert policy isn't set up (avoid leaking RLS surface
    // for a write-only telemetry row).
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (createAdminClient() as any).from('blog_quality_checks').insert({
        user_id: user.id,
        video_id: videoId,
        violations_found: selfCheck.violations.length,
        fixes_applied: selfCheck.fixesApplied,
        numbers_detected: selfCheck.numbersDetected,
        // Pattern labels Haiku returned — already short strings like
        // "ai-emphasis-defense" or "em-dash heading". Cap at 20 to
        // avoid runaway arrays from a misbehaving Haiku response.
        violation_patterns: selfCheck.violations.slice(0, 20).map(v => v.pattern || 'unknown'),
      })
    } catch (insErr) {
      console.warn('[blog/generate] failed to persist blog_quality_check:', insErr instanceof Error ? insErr.message : insErr)
    }
  } catch (err) {
    console.warn('[blog/generate] self-check threw — shipping unchanged:', err instanceof Error ? err.message : err)
  }

  // ── Holistic self-critique pass (Sprint 3, 2026-06-09) ───────────────────
  // The self-check above is a PATTERN matcher (11 enumerated tics). This pass
  // is an OPEN-ENDED harsh editor: it reads the whole post and rewrites the 3
  // weakest passages — flat verdicts, vague claims, generic "solid choice"
  // filler — the kind of weakness nobody pre-enumerated. Runs on Sonnet (a
  // critic should match the writer) but emits only targeted patches, so the
  // cost is ~half a cent per post. Modifies `content` in place BEFORE the WP
  // publish + blog_posts insert below, so its edits flow through naturally.
  // Best-effort: any failure ships the de-ticked text unchanged.
  try {
    const critique = await selfCritiqueBlogPost({
      content,
      productTitle: generated.title || '',
      maxEdits: 3,
      ctx: { userId: user.id, tier: (wp?.tier as string) ?? null },
    })
    if (critique.editsApplied > 0) {
      console.log(`[blog/generate] self-critique: applied ${critique.editsApplied}/${critique.edits.length} edits`,
        critique.edits.map(e => ({ weakness: e.weakness, applied: e.applied })))
      // Re-scrub — the critique rewrites can reintroduce banned voice/words.
      const channelUrlForRescrub = ((brand as Record<string, unknown> | null)?.youtube_channel_url as string | null) ?? null
      content = scrubVoicePatterns(scrubBanned(critique.content), { channelUrl: channelUrlForRescrub }).content
    } else if (critique.edits.length > 0) {
      console.log(`[blog/generate] self-critique: ${critique.edits.length} flagged but 0 applied (verbatim mismatch)`)
    }
  } catch (err) {
    console.warn('[blog/generate] self-critique threw — shipping unchanged:', err instanceof Error ? err.message : err)
  }

  // ── 6.1. Topical internal linking (SEO #15) — pick the 2–3 most relevant of
  //         the user's existing posts by token overlap and splice a "Related
  //         reviews" block before the FAQ. Skipped when nothing is relevant.
  try {
    const related = pickRelatedPosts(
      {
        title: generated.title,
        keyword: generated.seoKeyword || null,
        contentSnippet: content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800),
        postType: (generated as { postType?: string | null }).postType || null,
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

  // (Reviewer Trust Block intentionally NOT injected here — it's rendered
  // by the MVP plugin via a the_content filter at request time. That way
  // every existing post gets the block immediately on plugin upgrade, AND
  // edits in /customize → Reviewer Trust Block apply instantly without
  // re-generating posts. See wp-plugin/mvpaffiliate-platform.php section 7b.)

  // ── 6.2. High-intent CTA strip immediately under the Quick Verdict.
  //         Single biggest click target on the page — shown before the reader
  //         has to scroll past the verdict bullets. Colors + copy switch
  //         based on whether the affiliate URL points at Amazon vs. a direct
  //         brand link, and we always render an above-the-fold disclaimer.
  //         Idempotent — safe on rebuild (won't double-stack).
  try {
    if (productUrl) {
      const stripIsAmazon = /^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(productUrl)
      content = injectPriceStrip(content, {
        affiliateUrl: productUrl,
        isAmazon: stripIsAmazon,
        productName: (generated as { productName?: string | null }).productName || null,
      })
    }
  } catch { /* price strip is best-effort; never block generation */ }

  // Preserve the slug of any existing live WP post so rebuilds keep the same
  // URL (and the same Google indexing history). Only fall through to the
  // freshly-generated slug for genuinely new posts.
  const slug = existingSlug || generated.slug.slice(0, 60)

  // ── 7. Resolve tag IDs ────────────────────────────────────────────────────
  // Credentials come from `site` (multi-site resolver), not the legacy `wp`
  // bag. This is how we route a generate to a specific WordPress site when
  // siteId is provided in the body — the rest of `wp` (tier, amazon tag,
  // geniuslink keys) is still per-user, not per-site.
  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
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
  // For posts that already exist on WP (legacy posts attached via
  // /api/blog/attach-video, or any prior generate run on the same video) we
  // PATCH the live post in place so the URL + Google indexing history don't
  // reset. Slug is intentionally left alone in the update path even if WP
  // would accept a new one — that's the whole point of preserving it.
  let wpPost
  try {
    if (existingWpPostId) {
      // Rebuilds preserve the live URL + indexing history — the existing
      // status is whatever the user already had (publish or otherwise).
      // We don't override status on rebuilds even when a schedule is
      // present: scheduling a REGENERATE of a live post would be
      // surprising. If you need that, use a fresh post.
      try {
        wpPost = await wpService.updatePost(existingWpPostId, {
          title: generated.title,
          content,
          excerpt: generated.excerpt,
          status: 'publish',
          tags: tagIds,
          categories: categoryIds,
        })
      } catch (err: unknown) {
        // The stored wordpress_post_id no longer exists on WP — the post was
        // deleted on the site (or the DB drifted), so WP returns 404
        // rest_post_invalid_id "Invalid post ID". Don't fail the whole
        // generation: fall back to creating a FRESH post. The blog_posts upsert
        // below repoints wordpress_post_id to the new one (self-healing), and
        // the thumbnail/backlink steps now treat it as fresh (existingWpPostId
        // cleared). This was the #1 cause of "Internal Server Error" on
        // re-generates against a deleted post.
        const m = err instanceof Error ? err.message : String(err)
        if (/rest_post_invalid_id|invalid post id|"status":\s*404/i.test(m)) {
          console.warn(`[blog-generate] stored WP post ${existingWpPostId} is gone — creating fresh instead:`, m)
          existingWpPostId = null
          wpPost = await wpService.createPost({
            title: generated.title,
            slug,
            content,
            excerpt: generated.excerpt,
            status: wpStatus,
            ...(wpStatus === 'future' && scheduledForIso ? { date: scheduledForIso } : {}),
            tags: tagIds,
            categories: categoryIds,
            comment_status: 'closed',
            ping_status: 'closed',
          })
        } else {
          throw err // a real WP error (auth / 403 WAF / etc.) — keep failing loudly
        }
      }
    } else {
      // Fresh post — honor the requested wpStatus. 'future' requires a
      // `date` field (the scheduled publish time); 'draft' and 'publish'
      // both ignore it. wpService.createPost passes `date` straight to
      // the WP REST `date` field, which WP interprets in the site's
      // timezone — we send ISO 8601 with a Z (UTC) so there's no
      // ambiguity. The MVP plugin records it in the post's post_date
      // column and WP's internal cron handles the flip.
      wpPost = await wpService.createPost({
        title: generated.title,
        slug,
        content,
        excerpt: generated.excerpt,
        status: wpStatus,
        ...(wpStatus === 'future' && scheduledForIso ? { date: scheduledForIso } : {}),
        tags: tagIds,
        categories: categoryIds,
        comment_status: 'closed',
        ping_status: 'closed',
      })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : (errToMessage(err) || 'WordPress publish failed')
    await logFailure(supabase, user.id, videoId, 'wp_publish', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Fire IndexNow (Bing / Copilot / Yandex) for near-instant crawling of the new
  // URL — fire-and-forget so a slow or rejected ping NEVER blocks the response.
  // Google doesn't participate; the daily GSC sweep covers Google.
  // Multi-site: ping the SPECIFIC site's IndexNow key (each WP install has
  // its own key). Pass effectiveSiteId so a Wine-blog post pings Wine's key.
  // SKIP when scheduled — the URL isn't live yet (status=future or draft).
  // For wp-native: WP's own cron will publish at the scheduled time; we
  // don't currently re-ping IndexNow then (a follow-up could subscribe to
  // WP's transition_post_status hook).
  // For draft-flip: the cron worker will fire IndexNow when it flips the
  // post to publish.
  if (!isScheduled) {
    void pingIndexNowForUrl(supabase, ownerId, wpPost.link, effectiveSiteId).catch(() => {})
  }

  // ── 8.5. Upload YouTube thumbnail as featured image ───────────────────────
  // Skip for rebuilds on legacy WP posts — the creator already has a featured
  // image they hand-picked, and the rebuild's value is the body rewrite, not
  // a thumbnail swap. (Fresh generates still get the YT thumb as featured.)
  const youtubeVideoId = (v as Record<string, unknown>).youtube_video_id as string
  if (!existingWpPostId) {
    try {
      const thumbUrl = `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`
      let media
      try {
        media = await wpService.uploadImageFromUrl(thumbUrl, `${youtubeVideoId}.jpg`)
      } catch {
        const fallback = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`
        media = await wpService.uploadImageFromUrl(fallback, `${youtubeVideoId}.jpg`)
      }
      // CRITICAL: preserve the WP status from createPost. When the post was
      // created as 'future' (wp-native scheduling) or 'draft' (draft-flip),
      // hardcoding 'publish' here would force the post live immediately,
      // breaking the schedule. Only flip to 'publish' for non-scheduled
      // posts (where wpStatus is 'publish' anyway). For 'future' status,
      // re-send `date` so WordPress doesn't reset the scheduled timestamp
      // — REST PATCH without a date on a future post can drift the
      // post_date to "now" on some WP versions.
      await wpService.updatePost(wpPost.id, {
        title: generated.title, slug, content, excerpt: generated.excerpt,
        status: wpStatus,
        ...(wpStatus === 'future' && scheduledForIso ? { date: scheduledForIso } : {}),
        tags: tagIds, featured_media: media.id,
      })
    } catch { /* non-fatal — post is already published without thumbnail */ }
  }

  // ── 9. Save to blog_posts (upsert so re-generates update the WP post ID) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingPost } = await supabase
    .from('blog_posts')
    .select('id')
    .eq('user_id', ownerId)
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(1)
    // maybeSingle (not single) — first generate against a video has zero
    // rows in blog_posts. single() throws PGRST116 on the zero-row case,
    // which we logged but didn't act on, leaving existingPost undefined
    // implicitly. Switching to maybeSingle returns { data: null, error: null }
    // cleanly so the downstream "if (existingPost) update else insert"
    // logic actually works on fresh videos.
    .maybeSingle()

  // Extract the Geniuslink shortcode from the YouTube description so we can
  // tie it back to this post in /api/analytics/clicks. The link itself is
  // already created upstream (during generate-metadata) and lives in the
  // YouTube description; we just persist the code here for join purposes.
  const geniuslinkCode = extractGeniuslinkCode(
    (video as Record<string, unknown>).description as string | null | undefined,
  )

  const blogPayload = {
    user_id: ownerId,
    video_id: videoId,
    title: generated.title,
    slug,
    content,
    excerpt: generated.excerpt,
    // The blog_posts.status column is the MVP-side lifecycle, separate
    // from the WP-side status. We use 'published' even for scheduled
    // posts so the Library's status='published' filter still picks them
    // up — the "is it live yet?" question is answered by scheduled_for
    // being in the past, not by this column. (Previously we considered
    // a separate 'scheduled' status here, but it would have required
    // touching every status='published' filter in the codebase. The
    // scheduled_for column does the same job without the blast radius.)
    status: 'published',
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    // Set ONLY when the generate call was scheduled (scheduleMode +
    // scheduledFor were on the body). Live publishes leave both at null.
    // The Library reads scheduled_for to render the "Scheduled · X" pill
    // and to hide the Schedule/Publish-to-all buttons on rows that are
    // already queued.
    ...(isScheduled && scheduledForIso
      ? {
          scheduled_for: scheduledForIso,
          schedule_mode: scheduleMode,
        }
      : {}),
    // Tag the post with the wordpress_sites row it was published to so
    // /content can show "Wine Reviews" badges and per-site filters. Skip
    // the 'legacy' sentinel (Phase-3 bridge): that means the user is still
    // on legacy integrations.wordpress_* with no wordpress_sites row yet,
    // and writing 'legacy' to a uuid column would error.
    ...(site.site_id !== 'legacy' ? { wordpress_site_id: site.site_id } : {}),
    ai_model: 'claude-opus-4-8', // matches the #248 writer upgrade (was stale 'claude-sonnet-4-6')
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
  // `scheduled_for` + `schedule_mode` were added in migration 104. The
  // supabase-generated types haven't been regenerated yet, so an `as any`
  // cast on the table reference bypasses the strict shape check. Drop the
  // cast after `npx supabase gen types` runs.
  //
  // Defensive retry 2026-06-07: if the DB doesn't have migration 104 yet,
  // the insert fails with "column does not exist" on scheduled_for /
  // schedule_mode. Retry once without those keys so the schedule still
  // works (the post gets generated, the Library badge just won't appear
  // until the migration is run + page reloads).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripScheduleKeys = (p: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scheduled_for, schedule_mode, ...rest } = p
    return rest
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isMissingColumn104 = (err: any) =>
    err && typeof err.message === 'string' && /column .* (scheduled_for|schedule_mode).* does not exist/i.test(err.message)
  if (ep?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error: upErr } = await (supabase as any)
      .from('blog_posts')
      .update(blogPayload)
      .eq('id', ep.id)
      .select()
      .single()
    if (upErr && isMissingColumn104(upErr)) {
      console.warn('[blog-generate] migration 104 not applied, retrying update without scheduled_for/schedule_mode')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retry = await (supabase as any)
        .from('blog_posts')
        .update(stripScheduleKeys(blogPayload))
        .eq('id', ep.id)
        .select()
        .single()
      data = retry.data
      upErr = retry.error
    }
    if (upErr) {
      console.error('[blog-generate] blog_posts update failed', upErr.message)
      await logFailure(supabase, user.id, videoId, 'blog_generation', `blog_posts update: ${upErr.message}`)
      return NextResponse.json({ error: `Failed to save post record: ${upErr.message}` }, { status: 500 })
    }
    savedPost = data
  } else {
    // Insert with the same defensive retry as the update branch above —
    // gracefully degrade if migration 104 isn't applied yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data, error: insErr } = await (supabase as any)
      .from('blog_posts')
      .insert(blogPayload)
      .select()
      .single()
    if (insErr && isMissingColumn104(insErr)) {
      console.warn('[blog-generate] migration 104 not applied, retrying insert without scheduled_for/schedule_mode')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const retry = await (supabase as any)
        .from('blog_posts')
        .insert(stripScheduleKeys(blogPayload))
        .select()
        .single()
      data = retry.data
      insErr = retry.error
    }
    if (insErr) {
      console.error('[blog-generate] blog_posts insert failed', insErr.message)
      await logFailure(supabase, user.id, videoId, 'blog_generation', `blog_posts insert: ${insErr.message}`)
      return NextResponse.json({ error: `Failed to save post record: ${insErr.message}` }, { status: 500 })
    }
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
      await supabase
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
  void maybeEvolveLearnProfile(supabase, { userId: ownerId, tier: (wp?.tier as string) ?? null })

  // Fire-and-forget feedback distillation (Sprint 3). When this generation
  // included a fresh Rewrite note (or notes have accumulated), collapse the
  // raw notes into a deduplicated, weighted standing-rule set cached on
  // brand_profiles.distilled_feedback. Debounced 6h. No await — same pattern
  // as the LEARN evolution above. Reads + writes the OWNER's profile.
  void maybeDistillFeedback(supabase, { userId: ownerId, tier: (wp?.tier as string) ?? null })

  // Fire-and-forget IMPLICIT edit-pattern learning (Sprint 3 Part 2). Diffs our
  // stored drafts against the creator's edited WordPress versions and distills
  // the recurring changes into brand_profiles.edit_pattern_feedback. Debounced
  // 24h (edits trickle in over days). No await — reads + writes the OWNER's
  // profile. Safe no-op until migration 118 runs (catches missing column).
  void maybeLearnFromEdits(supabase, { userId: ownerId, tier: (wp?.tier as string) ?? null })

  // ── 10. Body images + cache purge ─────────────────────────────────────────
  // Heavy follow-up: title/body fact-checks, schema, and IN-ARTICLE IMAGES.
  // Defined once here, then run one of two ways (see just below the definition):
  //   • Interactive request → DEFERRED via Next.js after() so the user gets the
  //     published text instantly; images stream in within the remaining budget.
  //     (If the function is cut off, the post simply keeps its text — never 504s.)
  //   • Async job (isServiceCall) → awaited INLINE so the job only completes once
  //     images are attached. No after()-cutoff → reliable images. (#255 follow-up.)
  const deferredWork = async () => {
    // ── Video→blog backlink (SEO #21) ──────────────────────────────────────
    // Append a "Full written review" link to the source YouTube video's
    // description so the video drives authority to the post (and vice versa).
    // User-controllable (integrations.yt_backlink_enabled, default true) since
    // it writes to their own channel; needs YouTube OAuth. Fully best-effort.
    //
    // SKIP when scheduled — wpPost.link points to the eventual URL, but it
    // 404s until the post goes live. Linking from YouTube to a 404 would
    // be worse than no link. For draft-flip the cron will fire this when
    // it flips the post; for wp-native it's just skipped (future: post-
    // status-transition webhook from WP could fire it at publish time).
    if (!isScheduled) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: ytRow } = await supabase
          .from('integrations')
          .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry,yt_backlink_enabled')
          .eq('user_id', ownerId)
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
        const wpBaseUrl = (site.wordpress_url || '').replace(/\/$/, '')
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
            url: site.wordpress_url,
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
            { name: 'Home', url: wpBaseUrl || site.wordpress_url },
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
        // out a bogus spec. Pass the channel URL again so any bare @handles the
        // fact-check leaves behind also get wrapped.
        const channelUrlForRescrub = ((brand as Record<string, unknown> | null)?.youtube_channel_url as string | null) ?? null
        content = scrubVoicePatterns(scrubBanned(checked), { channelUrl: channelUrlForRescrub }).content
        try { await wpService.updatePost(wpPost.id, { content }) } catch { /* keep prior text */ }
        if (savedPost?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await supabase.from('blog_posts').update({ content }).eq('id', savedPost.id) } catch { /* non-fatal */ }
        }
      }
    } catch { /* non-fatal — keep the generated text */ }

    // ── Citation-guard pass (Sprint 2 hallucination layer, 2026-06-09) ───────
    // Belt-and-suspenders second fact-check that runs AFTER the broad one
    // above. Narrower scope: only "cite-or-omit" claim classes (numeric specs,
    // dimensions, model numbers, named materials, accessory lists, certs,
    // multi-function identity, numbered comparisons). Subjective voice +
    // lived-experience anecdotes are left untouched so this never flattens
    // the writer's prose.
    //
    // Silent strip — no per-claim report surfaced; we just publish the cleaner
    // version (matches the design decision from the Sprint 2 question pass).
    // Same safety rails as the prior pass: length floor + affiliate-link
    // preservation guards inside citationGuard() itself.
    try {
      const guarded = await claude.citationGuard(content, transcript, productResearch, { userId: user.id, tier: (wp?.tier as string) ?? null })
      if (guarded && guarded !== content) {
        const channelUrlForRescrub = ((brand as Record<string, unknown> | null)?.youtube_channel_url as string | null) ?? null
        content = scrubVoicePatterns(scrubBanned(guarded), { channelUrl: channelUrlForRescrub }).content
        try { await wpService.updatePost(wpPost.id, { content }) } catch { /* keep prior text */ }
        if (savedPost?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await supabase.from('blog_posts').update({ content }).eq('id', savedPost.id) } catch { /* non-fatal */ }
        }
      }
    } catch { /* non-fatal — keep the prior fact-checked text */ }

    // ── Title-vs-body identity fact-check (2026-06-07 fix) ───────────────────
    // After the body has settled (above body fact-check may have corrected it),
    // verify the title still names the SAME product. The original WagComb
    // incident had title="WagComb Electric Flea Comb" with body about "Woyamay
    // 4-in-1 chews" — passed both the title-only fact-check (title appeared
    // somewhere in the transcript) and the body-only fact-check (body matched
    // the transcript) because each only saw one half of the post. Now we ground
    // the title against the body directly. If they disagree, update the live WP
    // post + blog_posts row (slug stays the same so the URL doesn't churn).
    try {
      const newTitle = await claude.factCheckTitleVsBody(
        generated.title,
        content,
        { userId: user.id, tier: (wp?.tier as string) ?? null },
      )
      const cleaned = scrubBanned((newTitle || '').trim())
      if (cleaned && cleaned !== generated.title.trim()) {
        console.warn('[blog-factcheck-title-vs-body] title/body mismatch corrected', {
          from: generated.title,
          to: cleaned,
          postId: savedPost?.id,
          wpPostId: wpPost.id,
        })
        generated.title = cleaned
        try { await wpService.updatePost(wpPost.id, { title: cleaned }) } catch (err) {
          console.warn('[blog-factcheck-title-vs-body] WP updatePost failed', err instanceof Error ? err.message : String(err))
        }
        if (savedPost?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          try { await (supabase as any).from('blog_posts').update({ title: cleaned }).eq('id', savedPost.id) } catch { /* non-fatal */ }
        }
      }
    } catch { /* non-fatal — keep the prior title */ }

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
        // Parallel uploads — was sequential ~700ms each → 4 images = 2.8s.
        // The AI-generated path (further down at ~line 1288) already does
        // this; aligning here closes the gap.
        const uploaded = await Promise.all(userImageUrls.map(async (src, i) => {
          try {
            const media = await wpService.uploadImageFromUrl(src, `${slug}-body${i + 1}.jpg`)
            return media?.source_url
              ? { url: media.source_url, alt: altFor(i) }
              : { url: src, alt: altFor(i) } // fallback: embed the public URL directly
          } catch {
            return { url: src, alt: altFor(i) }
          }
        }))
        heroImageUrl = uploaded[0]?.url ?? heroImageUrl
        if (uploaded.length > 0) {
          // Spread images strictly at usable H2 boundaries — skip first H2
          // (opener), skip last (closer/tail boundary), skip Quick Verdict /
          // Related / FAQ / About tail. The original 2026-05 rule the user
          // asked to restore. See lib/blog-body-images.ts pickBodyImageOffsets.
          const offsets = pickBodyImageOffsets(content, uploaded.length)
          finalContent = insertImagesAtOffsets(
            content,
            offsets,
            uploaded.map(img => gutenbergImageBlock(img.url, img.alt)),
          )
          try { await wpService.updatePost(wpPost.id, { content: finalContent }) } catch { /* keep text-only post */ }
          if (savedPost?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            try { await supabase.from('blog_posts').update({ content: finalContent, body_images_count: uploaded.length }).eq('id', savedPost.id) } catch { /* non-fatal */ }
          }
        }
      } catch { /* non-fatal — the published text post stands */ }
    } else if (includeImages) {
      try {
        const falKey = process.env.FAL_KEY
        if (falKey) {
          fal.config({ credentials: falKey })

          // Server-side fallback: when no client-supplied frames came in (the
          // common case now that the browser-extension capture has been removed),
          // pull a handful of evenly-spaced storyboard frames from YouTube
          // directly — no tabs, no extension. Best-effort; if it fails we just
          // fall through to the existing product-re-stage path.
          if (capturedFrames.length === 0) {
            const ytId = (v as Record<string, string>).youtube_video_id
            if (ytId) {
              try {
                const sb = await fetchStoryboardFrames(ytId, { maxFrames: 4 })
                if (sb.length > 0) capturedFrames = sb.map(f => f.dataUrl)
              } catch { /* keep capturedFrames = [] */ }
            }
          }

          // Real video frames → re-host so we can retouch them. When present,
          // these drive the in-article images (real scene, AI-enhanced)
          // instead of product re-stages.
          const frameRefs: string[] = []
          for (const f of capturedFrames) {
            const u = await rehostToFal(f)
            if (u) frameRefs.push(u)
          }

          // Resolve the REAL product image through the SINGLE SOURCE OF
          // TRUTH (`lib/resolve-product-reference`). Every improvement to
          // any step (Amazon retry, vision picker, junk-URL filter, etc.)
          // automatically applies here, in refresh-images, in the
          // thumbnail route, and anywhere else that needs the canonical
          // product photo — no more drift between routes.
          let falProductImageUrl: string | null = null
          let productTitleForPrompts = generated.title

          const traceTag = `[blog-generate:${v.id?.toString().slice(0, 8) ?? 'video'}]`
          const ref = await resolveProductReference({
            uploadedUrl: (v.product_image_url as string | null)?.trim() || null,
            title: v.title as string | null ?? null,
            description: rawDescription,
            asin: effectiveAsin ?? null,
            wordpressUrl: site.wordpress_url ?? null,
            traceTag,
            userId: user.id,
            tier: (wp?.tier as string) ?? null,
          })
          if (ref.productTitle) {
            productTitleForPrompts = ref.productTitle
            schemaProductName = ref.productTitle
          }
          if (ref.productImageUrl) {
            schemaProductImage = schemaProductImage || ref.productImageUrl
            try {
              const imgRes = await fetch(ref.productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
              if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
              console.log(`${traceTag} step:fal-upload`, { ok: !!falProductImageUrl })
            } catch (e) {
              console.warn(`${traceTag} step:fal-upload FAILED`, { error: e instanceof Error ? e.message : String(e) })
            }
          }

          // Image count resolution. Two inputs:
          //   - includeImages (this request) = user TICKED the "Include
          //     photos" checkbox on THIS generation. Authoritative for
          //     this single post.
          //   - brand.blog_image_count = persistent default they set in
          //     Brand Profile.
          //
          // We're inside the `else if (includeImages)` branch, so the
          // user explicitly opted in for THIS post. If their Brand
          // Profile pref is 0 (or null), fall through to the word-scaled
          // default — never let the persisted "0" silently override
          // the explicit checkbox. 2026-06-08: user reported "every
          // time I click Include photos, no images" — root cause was
          // brand pref of 0 silently winning.
          const words = bodyWordCount(content)
          const rawPref = (brand as { blog_image_count?: number | null } | null)?.blog_image_count
          // Per-post checkbox override: treat 0 / null the same — use
          // the word-scaled default. Only honor 1..4 from brand pref.
          const userImageCount = typeof rawPref === 'number' && rawPref > 0 ? rawPref : null
          const imageCount = allowedBlogImages(tier, words, userImageCount)
          console.log('[generate] in-body image count resolved', {
            userId: user.id,
            includeImages: true,
            brandPref: rawPref ?? null,
            resolvedCount: imageCount,
          })
          if (imageCount === 0) {
            // Should be impossible given the override above, but kept
            // as a tripwire — surface clearly in logs.
            console.warn('[generate] image count resolved to 0 despite includeImages=true', { userId: user.id })
            if (savedPost?.id) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              try { await supabase.from('blog_posts').update({ body_images_count: 0 }).eq('id', savedPost.id) } catch { /* non-fatal */ }
            }
            throw new Error('__skip_in_body_images__')
          }
          const slots = await generateBodyImagePrompts({
            count: imageCount,
            productTitle: productTitleForPrompts,
            headings: sectionHeadings(content),
            base: generated.imagePrompts,
            ctx: { userId: user.id, tier: (wp?.tier as string) ?? null },
          })

          const tier2 = (wp?.tier as string) ?? null
          let firstImgError: string | null = null
          console.log('[blog-images] generating', { count: slots.length, falProduct: !!falProductImageUrl })
          const results = await Promise.all(slots.map(async (slot, i) => {
            const prompt = slot.prompt
            if (!prompt || !prompt.trim()) return null
            // The AI-written alt for this specific image. Falls back to the
            // descriptor-style altFor(i) if the slot somehow shipped without one.
            const altForThisImage = (slot.alt && slot.alt.trim()) || altFor(i)
            const perspective = SHOT_PERSPECTIVES[i % SHOT_PERSPECTIVES.length]
            const seed = Math.floor(Math.random() * 1_000_000_000) + i
            try {
              let falUrl: string | undefined
              // ── Primary: re-render the REAL product photo (resolved from the
              // Amazon / Geniuslink / affiliate link) into a fitting setting.
              // This keeps the ACTUAL product accurate — what readers came to
              // see — instead of guessing from random video frames.
              if (falProductImageUrl) {
                // Identity-preserving re-render via Nano Banana (Gemini Imagen).
                //
                // We previously used Flux Kontext here. Kontext is great at
                // RESTYLING but drifts on IDENTITY — ~half the in-article images
                // ended up showing "an office chair", not THIS office chair.
                // Nano Banana (the same model that powers identity-preserving
                // thumbnail composition) holds the exact product shape/colour/
                // branding from the reference image with high fidelity, then
                // only changes the background/scene to match the slot prompt.
                //
                // Prompt language is tighter than Kontext's: lead with the
                // identity contract ("keep IDENTICAL"), then the scene change.
                // Nano Banana follows directional instructions better when the
                // identity clause comes first.
                const nanoBananaInstruction = `Identity-preserving re-render of the product in the reference image. Keep its EXACT shape, colour, materials, proportions, surface texture, and every on-product branding/logo/label/text element IDENTICAL to the reference — do not redesign, restyle, simplify, swap, or invent any product. Treat the reference as ground truth for what the product LOOKS LIKE, nothing more.

CRITICAL — IGNORE all overlay graphics on the reference: the reference may be an Amazon listing or A+ Content infographic with headlines like "Ultimate ___" or "Premium ___", checkmark badges, circle callouts saying things like "Non-Slip" or "Stable Frame", feature-highlight pills, arrows pointing at product parts, side-by-side panels, or any kind of marketing text/graphic overlay. DO NOT reproduce ANY of those elements. DO NOT copy the reference's composition, layout, framing, or staging. The output image must contain ZERO overlay text, ZERO badges, ZERO callouts, ZERO marketing graphics. Strip ALL of that away and use ONLY the physical product itself.

CHANGE the entire scene: a brand-new background, a brand-new context where this product would actually be used, brand-new lighting, brand-new camera angle and distance. The product is the ONLY thing that carries over from the reference. Pose, position, orientation, and surroundings must all be different. Place the product naturally in a real-world setting (the actual location it would be used in everyday life). Vary the product's position/orientation/angle across renders so multiple images of the same product never look like the same shot.

Render as a polished magazine-quality editorial photo shown as a ${perspective}: ${prompt}. If a realistic setting truly doesn't fit, stage the unchanged product on a clean surface against a VIBRANT colour-pop / gradient background with soft studio lighting, reflections, and depth.

Realistic shadows and lighting. This must read as a COMPLETELY different photo from the article's other images — different background and environment, different surface, different lighting and time of day, different camera distance and angle. Do NOT reuse the reference photo's pose, framing, or background.

${NO_BRAND_IMAGE_CLAUSE} Landscape 4:3, photorealistic editorial product photography, no added text/captions/watermarks/badges/callouts/labels.`
                try {
                  const out = await composeWithNanoBanana({
                    prompt: nanoBananaInstruction,
                    referenceImageUrls: [falProductImageUrl],
                    aspectRatio: '4:3',
                    numImages: 1,
                  })
                  falUrl = out[0]
                  if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'nano-banana', images: 1 })

                  // ── Vision verification — second line of defense against the
                  // "wrong product" bug. The image model occasionally drifts
                  // even with strict identity prompts; ask Haiku vision whether
                  // the rendered image is actually the same product as the
                  // reference. If not, retry ONCE with a stricter prompt. If
                  // the retry still fails, fall back to the bare reference
                  // photo (it's not stylized but at least it's the actual
                  // product — much better than a wrong product in a fancy scene).
                  if (falUrl) {
                    const v = await verifyProductMatch(falProductImageUrl, falUrl, productTitleForPrompts, { userId: user.id, tier: tier2 })
                    console.log('[blog-images] verify', { i, match: v.match, reason: v.reason })
                    if (!v.match) {
                      const stricter = `IDENTITY-LOCKED render. The reference image is the GROUND TRUTH for what this product PHYSICALLY looks like — nothing else. The product in the reference is "${productTitleForPrompts}". The previous attempt rendered a DIFFERENT product, which is wrong. Copy the product from the reference EXACTLY — same shape, same colour, same cut-out / texture / pattern, same number of components, same on-product branding/text. Do NOT substitute a similar-looking product.

STRIP any overlay text, headlines, checkmark badges, callout circles, feature pills, comparison panels, or marketing graphics that may be on the reference — those are NOT part of the product, do not reproduce them. Use the reference ONLY to understand the product itself.

Place the product in a COMPLETELY NEW real-world scene — do NOT copy the reference's composition/pose/framing/background. Vary the angle and position. Background: ${prompt}.

${NO_BRAND_IMAGE_CLAUSE} Landscape 4:3, photorealistic editorial product photography, no added text/captions/badges/callouts.`
                      try {
                        const retry = await composeWithNanoBanana({
                          prompt: stricter,
                          referenceImageUrls: [falProductImageUrl],
                          aspectRatio: '4:3',
                          numImages: 1,
                        })
                        const retryUrl = retry[0]
                        if (retryUrl) {
                          recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image_retry', model: 'nano-banana', images: 1 })
                          const v2 = await verifyProductMatch(falProductImageUrl, retryUrl, productTitleForPrompts, { userId: user.id, tier: tier2 })
                          console.log('[blog-images] verify-retry', { i, match: v2.match, reason: v2.reason })
                          if (v2.match) {
                            falUrl = retryUrl
                          } else {
                            // Both attempts produced a wrong product. Use the
                            // bare reference image as the in-article image —
                            // unstylized but correct identity. Better signal
                            // to the reader than a wrong product.
                            console.warn('[blog-images] both attempts failed verification — using bare reference', { i, reasons: [v.reason, v2.reason] })
                            falUrl = falProductImageUrl
                          }
                        }
                      } catch { /* keep the unverified original, last-resort */ }
                    }
                  }
                } catch { /* fall through to frame / text-to-image */ }
              } else {
                // Diagnostic: when we end up here, the product reference image
                // chain (uploaded photo → Amazon ASIN → page scrape) ALL fell
                // through. The image will be generated text-only against the
                // slot prompt, which on review-style articles often produces a
                // similar-but-wrong product (the exact failure surfaced by
                // gominreviews.com/plug-in-wax-melt-warmer-review). Log so we
                // can correlate Vercel logs to bad articles.
                console.warn('[blog-images] NO product reference resolved — falling through to text-only', { i, productTitleForPrompts, hasAsin: !!effectiveAsin })
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
              // Try uploading to WP media first so the image lives on the user's
              // own domain. If that fails (Hostinger / WAF often blocks the
              // multipart POST to /wp-json/wp/v2/media even when the regular
              // posts endpoint is open), fall back to the fal storage URL
              // directly — the image still renders in the article via <img>,
              // it's just hosted on fal.media instead of the user's wp-uploads.
              let mediaUrl: string | null = null
              try {
                const media = await wpService.uploadImageFromUrl(falUrl, `${slug}-body${i + 1}.jpg`)
                mediaUrl = media?.source_url || null
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                if (!firstImgError) firstImgError = `wp-media: ${msg}`
                console.warn(`[blog-images] item ${i} WP media upload failed, embedding fal URL directly:`, msg)
              }
              return { url: mediaUrl || falUrl, alt: altForThisImage }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              if (!firstImgError) firstImgError = msg
              console.warn(`[blog-images] item ${i} failed:`, msg)
              return null
            }
          }))
          const uploaded = results.filter((r): r is { url: string; alt: string } => !!r)
          heroImageUrl = uploaded[0]?.url ?? heroImageUrl
          console.log('[blog-images] result', { produced: uploaded.length, of: slots.length, firstError: firstImgError, falProduct: !!falProductImageUrl, frames: frameRefs.length })
          if (uploaded.length === 0) {
            try { await logFailure(supabase, user.id, videoId, 'blog_body_images', `0/${slots.length} images. falProduct=${!!falProductImageUrl}. frames=${frameRefs.length}. firstError=${firstImgError || 'none'}`) } catch { /* non-fatal */ }
          }
          if (uploaded.length > 0) {
            // See the user-images branch (~line 1215) for the picker
            // rationale — H2-only spread, skip opener + closer + tail
            // blocks, no paragraph fallback (it caused clustering).
            const placementOffsets = pickBodyImageOffsets(content, uploaded.length)
            finalContent = insertImagesAtOffsets(
              content,
              placementOffsets,
              uploaded.map(img => gutenbergImageBlock(img.url, img.alt)),
            )
            // Push the image-enriched body into the live WP post + our DB.
            // updatePost with only `content` leaves the featured image / tags
            // / status untouched (WP REST partial update).
            try { await wpService.updatePost(wpPost.id, { content: finalContent }) } catch (e) {
              console.warn('[blog-images] WP updatePost (insert images) failed:', e instanceof Error ? e.message : String(e))
            }
            if (savedPost?.id) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              try { await supabase.from('blog_posts').update({ content: finalContent }).eq('id', savedPost.id) } catch { /* non-fatal */ }
            }
          }

          // Diagnostic: write the produced count back to the row so the
          // Content page can render a small "🖼 N body images" badge and we
          // stop having to grep Vercel logs to know if image-gen worked.
          if (savedPost?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            try { await supabase.from('blog_posts').update({ body_images_count: uploaded.length }).eq('id', savedPost.id) } catch { /* non-fatal */ }
          }
        }
      } catch (e) {
        // Sentinel "user set 0 images" — already handled above (count
        // written, log emitted). Swallow quietly so we don't log a
        // misleading "branch threw" line for an intentional opt-out.
        if (e instanceof Error && e.message === '__skip_in_body_images__') {
          // intentional skip — no further action needed
        } else {
          // The published text post stands — but log what blew up so we can see
          // it instead of staring at "no images" with zero signal.
          console.warn('[blog-images] AI-generation branch threw:', e instanceof Error ? e.message : String(e))
          if (savedPost?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            try { await supabase.from('blog_posts').update({ body_images_count: 0 }).eq('id', savedPost.id) } catch { /* non-fatal */ }
          }
        }
      }
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
  }

  if (isServiceCall) {
    // Async job — nobody is waiting on latency, so run the image/fact-check work
    // INLINE. The job then completes only once images are attached (the runner
    // waits for this response), eliminating the after()-cutoff that left async
    // posts image-less. Best-effort: the post is already published, so a failure
    // here must never fail the job — log and move on.
    try {
      await deferredWork()
    } catch (e) {
      console.warn('[blog-generate] inline deferred work failed (post already published):', e instanceof Error ? e.message : String(e))
    }
  } else {
    // Interactive request: defer so the response returns immediately.
    after(deferredWork)
  }

  return NextResponse.json({
    success: true,
    postId: savedPost?.id,
    wordpressPostId: wpPost.id,
    wordpressUrl: wpPost.link,
    title: generated.title,
    productUrl,
    hasImages: includeImages,
    // false when both transcript sources failed; the article was grounded on
    // description + product info only. The client can show a soft notice —
    // the post is fine, just a bit shorter / less specific.
    transcriptUsed,
    // Which source supplied the transcript so the UI can surface it
    // (cache / youtube_api / scraper / none).
    transcriptSource,
    // Schedule echo — the schedule-publish route uses these to wire the
    // social cascade rows back to this post. Clients can also surface
    // "Scheduled for X" on the success toast.
    scheduled: isScheduled
      ? { mode: scheduleMode, scheduledFor: scheduledForIso ?? null, wpStatus }
      : null,
  })
}

async function logFailure(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  userId: string,
  videoId: string,
  jobType: 'blog_generation' | 'wp_publish' | 'blog_body_images',
  errorMessage: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
