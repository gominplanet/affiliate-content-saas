import { NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { YoutubeTranscript } from 'youtube-transcript'
import { checkUsageLimit, TIERS, nextTierFor, allowedBlogImages, type Tier } from '@/lib/tier'
import { scrubBanned } from '@/lib/scrub'
import { discoverProductForVideo } from '@/lib/product-detect'
import { createGeniuslinkService } from '@/services/geniuslink'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { researchProductFromUrl, researchProductByWebSearch } from '@/services/research'
import { maybeEvolveLearnProfile } from '@/lib/learn-evolve'
import { gutenbergImageBlock, insertImagesAtHeadings, autoPlacementIndices } from '@/lib/blog-body-images'
import { fal } from '@fal-ai/client'
import { recordUsage, recordAnthropicUsage } from '@/lib/ai-usage'
import { createAnthropicClient } from '@/lib/anthropic'

/** Distinct camera perspectives cycled across a post's in-body images so
 *  no two shots look alike — each Kontext/flux call gets a different angle
 *  + framing even though the product reference is the same. */
const SHOT_PERSPECTIVES = [
  'extreme close-up macro detail shot, shallow depth of field, product fills the frame',
  'wide environmental shot — the product small within a full real-room setting, lots of context',
  'overhead top-down flat-lay on a clean surface, styled with a few relevant props',
  'in-hand point-of-view shot — the product held and actively being used',
  'three-quarter angle on a wooden table with soft directional side lighting',
  'low hero angle looking slightly up at the product against a softly blurred lifestyle background',
]

/** The product/store URL a creator links in the description — used both as
 *  the affiliate link (when there's no Amazon product) and as the page we
 *  scrape for product facts. Amazon/geni.us links are handled by the
 *  Amazon path; socials, payment, and the creator's own site are skipped.
 *
 *  Prefers a URL that follows a buy/price CTA ("Check Today's Price and
 *  Availability here: <url>") — that's the actual product link — over the
 *  first random link (which is often a collaborations/website link).
 *  Returns null when nothing product-like is linked. */
function firstProductUrl(description: string, ownSite?: string | null): string | null {
  // NOTE: geni.us / amzn.to are NOT skipped here — a creator's product link
  // may BE a Geniuslink (any destination) or an Amazon short link, and we
  // want to recognize + resolve those. Full amazon.com links are handled by
  // the ASIN path before this runs. We only skip socials, payments, link
  // hubs, and the creator's own collaboration/site links.
  const skip = /(youtu\.?be|youtube\.com|instagram\.com|tiktok\.com|facebook\.com|fb\.com|twitter\.com|x\.com|linktr\.ee|linkedin\.com|pinterest\.|threads\.net|bsky\.|t\.me|discord\.|patreon\.|paypal\.|alexmediacreations)/i
  const own = ownSite ? ownSite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
  const candidate = (raw: string): string | null => {
    const clean = raw.replace(/[.,;:)\]>"']+$/, '')
    if (skip.test(clean)) return null
    if (own && clean.includes(own)) return null
    return clean
  }
  // 1. URL right after a buy/price/availability cue — the product link.
  const cta = description.match(/(?:today'?s price|price|availability|buy(?:\s+it)?|shop|purchase|order|get yours|grab|available (?:here|at)|here)\b[:\s]*[\s\S]{0,40}?(https?:\/\/[^\s)>\]"']+)/i)
  if (cta) { const c = candidate(cta[1]); if (c) return c }
  // 2. Else the first non-excluded URL anywhere.
  for (const raw of description.match(/https?:\/\/[^\s)>\]"']+/gi) || []) {
    const c = candidate(raw); if (c) return c
  }
  return null
}

/** Follow a short link / redirect to its FINAL destination URL. Used to
 *  "look up" links before assuming what they are — a geni.us or amzn.to
 *  could resolve to Amazon OR to any store. Best-effort; returns the
 *  original URL on failure. */
async function resolveFinalUrl(url: string): Promise<string> {
  // Hard timeouts so a slow/hanging redirect host can never stall the
  // generation request (which runs close to the function's time budget).
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    return res.url || url
  } catch {
    try {
      // Some hosts reject HEAD — retry with a ranged GET (1 byte).
      const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0' }, signal: AbortSignal.timeout(5000) })
      return res.url || url
    } catch {
      return url
    }
  }
}

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

/** Pull the H2/H3 heading texts from the body, in order — used as context
 *  so each generated image relates to the section it sits above. */
function sectionHeadings(content: string): string[] {
  const out: string[] = []
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const t = m[1].replace(/<[^>]+>/g, '').trim()
    if (t) out.push(t)
  }
  return out
}

/**
 * Produce `count` distinct image-generation prompts for the post body.
 * One Haiku call returns scene prompts tied to the article's sections so
 * the photos feel relevant rather than generic. Falls back to cycling the
 * base lifestyle/setting/hero prompts if the call fails.
 */
async function generateBodyImagePrompts(opts: {
  count: number
  productTitle: string
  headings: string[]
  base: { hero: string; lifestyle: string; setting: string }
  ctx: { userId: string | null; tier: string | null }
}): Promise<string[]> {
  const cycle = (n: number): string[] => {
    const pool = [opts.base.lifestyle, opts.base.setting, opts.base.hero].filter(Boolean)
    if (pool.length === 0) return []
    return Array.from({ length: n }, (_, i) => pool[i % pool.length])
  }
  if (opts.count <= 2) return cycle(opts.count)
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write exactly ${opts.count} distinct image-generation prompts for photos placed throughout a product review article.

PRODUCT: ${opts.productTitle || 'the reviewed product'}
ARTICLE SECTIONS (one image sits above each — match the scene to the section):
${opts.headings.slice(0, opts.count).map((h, i) => `${i + 1}. ${h}`).join('\n')}

RULES:
- Each prompt: a clean, realistic editorial product photo. Vary the angle/scene (in-use lifestyle, close-up detail, flat-lay, in-situ environment).
- Show the EXACT product. No packaging, no boxes.
- NO text, letters, logos, or watermarks in the image.
- Each under 35 words.
Return ONLY a JSON array of ${opts.count} strings, nothing else.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'blog_body_image_prompts', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as string[]
      const cleaned = arr.map(s => (s || '').trim()).filter(Boolean)
      if (cleaned.length > 0) {
        // Pad with cycled prompts if Haiku returned fewer than asked.
        while (cleaned.length < opts.count) cleaned.push(cycle(opts.count)[cleaned.length])
        return cleaned.slice(0, opts.count)
      }
    }
  } catch { /* fall through to cycle */ }
  return cycle(opts.count)
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

  const body = (await request.json()) as { videoId?: string; rewriteFeedback?: string; includeImages?: boolean }
  const { videoId, rewriteFeedback } = body
  // Default ON when omitted (older callers / bulk triggers) — the Content
  // page sends the explicit per-generation choice.
  const includeImages = body.includeImages !== false
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
    const tier = (intRow?.tier as Tier) ?? 'trial'
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
  const tier = ((wp?.tier as Tier) ?? 'trial')
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
  generated.imagePrompts = {
    hero: scrubBanned(generated.imagePrompts.hero),
    lifestyle: scrubBanned(generated.imagePrompts.lifestyle),
    setting: scrubBanned(generated.imagePrompts.setting),
  }

  // ── 6. Clean any vestigial placeholders (the prompt no longer emits
  //        these, but strip defensively in case an old prompt variant does) ─
  let content = generated.content
    .replace('{{LIFESTYLE_IMAGE}}', '')
    .replace('{{SETTING_IMAGE}}', '')

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

  // ── 7.5. Sync author display name to WordPress ───────────────────────────
  const authorName = (brand as Record<string, unknown>).author_name as string | null
  if (authorName) {
    try {
      await wpService.updateCurrentUserDisplayName(authorName)
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
    let finalContent = content
    if (includeImages) {
      try {
        const falKey = process.env.FAL_KEY
        if (falKey) {
          fal.config({ credentials: falKey })

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
              if (p.title) productTitleForPrompts = p.title
              if (!falProductImageUrl && p.imageUrl) {
                const imgRes = await fetch(p.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
                if (imgRes.ok) falProductImageUrl = await fal.storage.upload(await imgRes.blob())
              }
            } catch { /* fall back to text-only prompts */ }
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
          const results = await Promise.all(prompts.map(async (prompt, i) => {
            if (!prompt || !prompt.trim()) return null
            const perspective = SHOT_PERSPECTIVES[i % SHOT_PERSPECTIVES.length]
            const seed = Math.floor(Math.random() * 1_000_000_000) + i
            try {
              let falUrl: string | undefined
              if (falProductImageUrl) {
                const kontextInstruction = `Keep the exact product object from this image — its shape, colour, material, branding, and all details — but show it from a NEW, DISTINCT perspective: ${perspective}. Remove the white background and any packaging. Place the product naturally into this scene: ${prompt}. This image MUST look clearly different from the other photos in the article — different angle, different framing, different surroundings. Realistic shadows and lighting. ABSOLUTELY NO TEXT, LETTERS, WORDS, LOGOS (other than what's physically on the product), OR WATERMARKS anywhere in the scene. Landscape 4:3 editorial product photography.`
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const k = await fal.subscribe('fal-ai/flux-pro/kontext' as any, {
                  input: { image_url: falProductImageUrl, prompt: kontextInstruction, aspect_ratio: '4:3', num_images: 1, output_format: 'jpeg', guidance_scale: 5, seed },
                  pollInterval: 3000,
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                falUrl = ((k.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
                if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'fal-flux-pro-kontext', images: 1 })
              }
              if (!falUrl) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
                  input: { prompt: `${prompt}. Shown as a ${perspective}. Editorial product photography, natural lighting, sharp focus, photorealistic, 8K. ABSOLUTELY NO TEXT, LETTERS, WORDS, LOGOS, OR WATERMARKS anywhere in the image.`, image_size: 'landscape_4_3', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2', seed },
                  pollInterval: 3000,
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                falUrl = ((result.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url
                if (falUrl) recordUsage({ userId: user.id, tier: tier2, feature: 'blog_body_image', model: 'fal-flux-pro-v1.1', images: 1 })
              }
              if (!falUrl) return null
              const media = await wpService.uploadImageFromUrl(falUrl, `${slug}-body${i + 1}.jpg`)
              return media?.source_url ? { url: media.source_url, alt: `${generated.title} — ${i + 1}` } : null
            } catch { return null }
          }))
          const uploaded = results.filter((r): r is { url: string; alt: string } => !!r)
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

    // Purge LiteSpeed cache LAST so the cached page reflects the images we
    // just added. Re-POST the EXACT live customizations (never a stale local
    // blob — that would wipe about.headerBannerUrl). Skip on GET failure.
    try {
      const wpBase = wp.wordpress_url.replace(/\/$/, '')
      const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`)
      if (getRes.ok) {
        const existing = await getRes.json()
        if (existing && typeof existing === 'object' && !Array.isArray(existing) && Object.keys(existing as object).length > 0) {
          await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(existing),
          })
        }
      }
    } catch { /* non-fatal — post is published regardless */ }
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
  jobType: 'blog_generation' | 'wp_publish',
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
