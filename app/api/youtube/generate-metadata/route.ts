import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct } from '@/services/amazon'
import { discoverProductForVideo } from '@/lib/product-detect'
import { resolveProductLink } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { scoreTitle } from '@/lib/thumbnail-score'

export const maxDuration = 120

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

// ── Retry wrapper for Anthropic 529 overloaded errors ────────────────────────
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  let delay = 2000
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Record<string, unknown>)?.status as number | undefined
      const msg = err instanceof Error ? err.message : String(err)
      const isOverloaded = status === 529 || msg.includes('529') || msg.toLowerCase().includes('overloaded')
      if (!isOverloaded || attempt === maxAttempts) {
        if (isOverloaded) throw new Error('Claude AI is temporarily overloaded — please try again in a moment.')
        throw err
      }
      console.warn(`[anthropic-retry] 529 overloaded, attempt ${attempt}/${maxAttempts}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 15000)
    }
  }
  throw new Error('Claude AI is temporarily overloaded — please try again in a moment.')
}

// ── Agent runner helper ───────────────────────────────────────────────────────
// Telemetry context — set once at the top of POST and consumed by every
// runAgent call below, so each of the 5 swarm agents gets recorded with
// the right user/tier instead of bucketing as "unknown".
let TELEMETRY: { userId: string | null; tier: string | null } = { userId: null, tier: null }

async function runAgent(
  anthropic: Anthropic,
  opts: { model: string; system: string; user: string; maxTokens?: number; feature: string }
): Promise<string> {
  const msg = await withRetry(() => anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  }))
  recordAnthropicUsage(msg, {
    userId: TELEMETRY.userId, tier: TELEMETRY.tier,
    feature: opts.feature, model: opts.model,
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

function parseJSON<T>(raw: string, fallback: T): T {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return fallback
  try { return JSON.parse(match[0]) as T } catch { return fallback }
}

// ── AGENT 1: Product / Video Analyst ──────────────────────────────────────────
// In product mode this analyses an Amazon product for a review video.
// In general mode (no ASIN) this analyses the video's topic and intent
// instead — the JSON field names are reused but semantically describe
// the viewer rather than the buyer.
async function productAnalystAgent(
  anthropic: Anthropic,
  productContext: string,
  videoTitle: string,
  niches: string,
  isProduct: boolean,
): Promise<{ targetBuyer: string; topBenefits: string[]; painPoints: string[]; keywords: string[] }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 800,
    feature: 'yt_meta_product_analyst',
    system: isProduct
      ? 'You are a product research specialist. Analyse Amazon products for YouTube content. Return ONLY valid JSON.'
      : 'You are a YouTube content analyst. You break down videos by topic, intent, and the viewer they serve. Return ONLY valid JSON.',
    user: isProduct
      ? `Analyse this product for a YouTube review in the "${niches}" niche.

PRODUCT DATA:
${productContext}

VIDEO TITLE: "${videoTitle}"

Return JSON:
{
  "targetBuyer": "one sentence describing the ideal customer",
  "topBenefits": ["top 3 benefits that drive purchase decisions"],
  "painPoints": ["top 3 problems this product solves"],
  "keywords": ["10 exact search terms buyers type into YouTube/Google for this product — plain words only, no special characters"]
}`
      : `Analyse this YouTube video in the "${niches}" niche. It is NOT a product review — focus on the video's topic, story, and the viewer it serves.

VIDEO CONTEXT:
${productContext}

VIDEO TITLE: "${videoTitle}"

Return JSON (field names kept for compatibility — read them as viewer-focused):
{
  "targetBuyer": "one sentence describing the ideal viewer for this video",
  "topBenefits": ["top 3 things a viewer will learn / experience / take away"],
  "painPoints": ["top 3 questions or curiosities this video answers for the viewer"],
  "keywords": ["10 exact search terms people would type into YouTube/Google to find this kind of video — plain words only, no special characters"]
}`,
  })
  return parseJSON(raw, { targetBuyer: '', topBenefits: [], painPoints: [], keywords: [] })
}

// ── AGENT 2: Title Strategist ─────────────────────────────────────────────────
async function titleStrategistAgent(
  anthropic: Anthropic,
  productContext: string,
  videoTitle: string,
  tone: string,
  productAnalysis: { targetBuyer: string; topBenefits: string[]; painPoints: string[] },
  isProduct: boolean,
  /** The user's most recent generated titles — used as voice anchors
   *  so the title cadence matches their channel over time. */
  priorTitles?: string[] | null,
): Promise<{ best: string; alternatives: string[] }> {
  const voiceAnchor = (priorTitles && priorTitles.length > 0)
    ? `\n\nUSER'S RECENT TITLES (match this cadence + hook style; do NOT copy):\n${priorTitles.map(t => `- "${t}"`).join('\n')}\n`
    : ''
  const raw = await runAgent(anthropic, {
    model: 'claude-sonnet-4-6',
    maxTokens: 600,
    feature: 'yt_meta_title_strategist',
    system: 'You are a viral YouTube title strategist. You write titles that dominate search and maximise click-through rate. Return ONLY valid JSON.',
    user: `Write 5 viral YouTube title options for this ${isProduct ? 'product review' : 'video (not a product review — it is general content)'}.

${isProduct ? 'PRODUCT' : 'VIDEO CONTEXT'}: ${productContext}
ORIGINAL TITLE: "${videoTitle}"
${isProduct ? 'TARGET BUYER' : 'TARGET VIEWER'}: ${productAnalysis.targetBuyer}
${isProduct ? 'TOP BENEFITS' : 'KEY TAKEAWAYS'}: ${productAnalysis.topBenefits.join(', ')}
${isProduct ? 'PAIN POINTS' : 'VIEWER QUESTIONS'}: ${productAnalysis.painPoints.join(', ')}
TONE: ${tone}

TITLE RULES:
${isProduct
  ? `- Lead with a power hook — choose from: "Worth It?", "Before You Buy", "I Tested", "Don't Buy Until...", "Is It Worth It?", "Real Talk:", "Watch This First", "We Tried It"
- Include the exact product name people search for`
  : `- Lead with a curiosity / story hook — choose from: "How I…", "Here's What Happened When…", "I Tried…", "Watch This First", "The Truth About…", "Why I…", "What Nobody Tells You About…"
- Make the topic of the video unmissable in the title`}
- NEVER use the word "honest" anywhere in the title
- Add an emotional trigger or specific outcome
- Under 100 characters
- No ASIN, no hashtags, no emojis

Return JSON:
{
  "best": "the single strongest title",
  "alternatives": ["4 other strong options"]
}${voiceAnchor}`,
  })
  return parseJSON(raw, { best: videoTitle, alternatives: [] })
}

// ── AGENT 3: SEO Researcher ───────────────────────────────────────────────────
async function seoResearcherAgent(
  anthropic: Anthropic,
  productContext: string,
  videoTitle: string,
  niches: string,
  productKeywords: string[],
  isProduct: boolean,
): Promise<{ tags: string[]; hashtags: string }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 900,
    feature: 'yt_meta_seo_researcher',
    system: 'You are a YouTube SEO expert. You research high-traffic keywords and trending hashtags. Return ONLY valid JSON.',
    user: `Generate maximum-reach YouTube tags and hashtags for this ${isProduct ? 'product review' : 'video (not a product review — general content)'}.

${isProduct ? 'PRODUCT' : 'VIDEO CONTEXT'}: ${productContext}
VIDEO TITLE: "${videoTitle}"
NICHE: ${niches}
KNOWN KEYWORDS: ${productKeywords.join(', ')}

RULES:
- Tags: plain text only, NO special characters (#"[]{}()), NO emojis, each tag under 30 words
${isProduct
  ? '- Hashtags: include #ad #affiliate #productreview plus 15-19 niche-specific ones, space-separated\n- Mix: brand name, product type, use case, comparison terms, problem-solution terms, broad category'
  : '- Hashtags: 18-22 niche-specific ones, space-separated. Do NOT include #ad / #affiliate / #productreview — this is not a sponsored / product video.\n- Mix: topic, audience descriptors, use case, niche category, broader content category'}

Return JSON:
{
  "tags": ["25 YouTube tags — plain words/phrases only, no special characters, mix of exact-match and long-tail"],
  "hashtags": "#hashtag1 #hashtag2 ... (18-22 total, space-separated)"
}`,
  })
  return parseJSON(raw, { tags: [], hashtags: '' })
}

// ── AGENT 4: Content Writer ───────────────────────────────────────────────────
async function contentWriterAgent(
  anthropic: Anthropic,
  productAnalysis: { targetBuyer: string; topBenefits: string[]; painPoints: string[] },
  bestTitle: string,
  tone: string,
  niches: string,
  isProduct: boolean,
  /** The user's most recent generated descriptions — voice anchors
   *  so each new description sounds more like their channel's. */
  priorDescriptions?: string[] | null,
): Promise<{ productDescription: string }> {
  const voiceAnchor = (priorDescriptions && priorDescriptions.length > 0)
    ? `\n\nUSER'S RECENT DESCRIPTIONS (match the cadence + voice, do NOT copy):\n${priorDescriptions.map((d, i) => `── EXAMPLE ${i + 1} ──\n${d.slice(0, 400)}`).join('\n\n')}\n`
    : ''
  const raw = await runAgent(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 600,
    feature: 'yt_meta_content_writer',
    system: 'You are a YouTube content writer who optimises descriptions for AI answer engines (ChatGPT, Gemini, Perplexity). Return ONLY valid JSON.',
    user: `Write a ${isProduct ? 'product' : 'video'} description optimised for YouTube, Google, and AI search engines.

VIDEO TITLE: "${bestTitle}"
${isProduct ? 'TARGET BUYER' : 'TARGET VIEWER'}: ${productAnalysis.targetBuyer}
${isProduct ? 'TOP BENEFITS' : 'KEY TAKEAWAYS'}: ${productAnalysis.topBenefits.join(', ')}
${isProduct ? 'PAIN POINTS SOLVED' : 'VIEWER QUESTIONS ANSWERED'}: ${productAnalysis.painPoints.join(', ')}
TONE: ${tone}
NICHE: ${niches}

RULES:
- 3-4 sentences maximum
- ${isProduct
    ? 'Answer: What is it? Who is it for? What is the #1 benefit? Is it worth buying?'
    : 'Answer: What is this video about? Who is it for? What will viewers learn or experience? Why should they keep watching?'}
- Use natural search language — write how people TALK, not how brands write
- Optimised for AI answer engines to feature in results
- No hashtags, no links, no special characters

Return JSON:
{
  "productDescription": "3-4 sentences..."
}${voiceAnchor}`,
  })
  return parseJSON(raw, { productDescription: '' })
}

// ── AGENT 5: Engagement Specialist ───────────────────────────────────────────
async function engagementAgent(
  anthropic: Anthropic,
  bestTitle: string,
  productAnalysis: { targetBuyer: string; topBenefits: string[] },
  affiliateUrl: string,
  tone: string,
  /** The user's most recent pinned comments — voice anchors so the
   *  pinned-comment voice matches their channel. */
  priorPinnedComments?: string[] | null,
): Promise<{ pinnedComment: string }> {
  const hasLink = !!affiliateUrl
  const voiceAnchor = (priorPinnedComments && priorPinnedComments.length > 0)
    ? `\n\nUSER'S RECENT PINNED COMMENTS (match the voice + hook style, do NOT copy):\n${priorPinnedComments.map((c, i) => `── EXAMPLE ${i + 1} ──\n${c.slice(0, 350)}`).join('\n\n')}\n`
    : ''
  const raw = await runAgent(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 400,
    feature: 'yt_meta_engagement',
    system: 'You are a YouTube engagement specialist who writes high-converting pinned comments. Return ONLY valid JSON.',
    user: `Write a pinned comment for this YouTube video that drives engagement.

VIDEO TITLE: "${bestTitle}"
${hasLink ? 'TARGET BUYER' : 'TARGET VIEWER'}: ${productAnalysis.targetBuyer}
${hasLink ? 'TOP BENEFIT' : 'KEY TAKEAWAY'}: ${productAnalysis.topBenefits[0] || 'a strong takeaway'}
${hasLink ? `AFFILIATE LINK: ${affiliateUrl}` : 'AFFILIATE LINK: (none — this is general video content, no product)'}
TONE: ${tone}

RULES:
- 2-3 punchy sentences
- Start with a hook or key insight from the video
${hasLink
  ? '- Include the affiliate link naturally\n- End with a CTA (check price, grab yours, limited stock, etc.)'
  : '- End with a CTA that drives engagement — invite a comment, ask a question, prompt a like or subscribe — never push a product link'}
- Feel human and conversational — not salesy

Return JSON:
{
  "pinnedComment": "${hasLink ? '2-3 sentence pinned comment with link' : '2-3 sentence pinned comment, no link'}..."
}${voiceAnchor}`,
  })
  return parseJSON(raw, { pinnedComment: '' })
}

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { asin, videoTitle, videoDescription, youtubeVideoId } = await request.json() as {
      asin?: string | null
      videoTitle: string
      videoDescription?: string
      /** YouTube native ID (e.g. dQw4w9WgXcQ). Used to persist
       *  generated metadata back to youtube_videos for the voice-
       *  anchor loop. Optional — generation still works without it. */
      youtubeVideoId?: string | null
    }

    // ASIN is OPTIONAL. With a valid ASIN we treat the video as a product
    // review (Amazon scrape + affiliate URL + product-flavoured prompts).
    // Without one, we fall back to generic-video mode — same agent swarm,
    // but the prompts skip product framing and the description skips the
    // affiliate / disclosure block.
    let trimmedAsin = (asin || '').trim().toUpperCase()
    let isProduct = !!trimmedAsin && /^[A-Z0-9]{10}$/.test(trimmedAsin)
    let productDiscoverySource: 'title' | 'caller' | 'search' | 'none' = isProduct ? 'caller' : 'none'
    if (asin && asin.trim() && !isProduct) {
      return NextResponse.json({
        error: 'That looks like an ASIN but the format is wrong — Amazon ASINs are 10 chars, uppercase letters + digits.',
      }, { status: 400 })
    }
    if (!videoTitle?.trim()) {
      return NextResponse.json({ error: 'videoTitle is required' }, { status: 400 })
    }

    // ── Fetch brand + credentials in parallel ─────────────────────────────────
    const [brandResult, intResult] = await Promise.all([
      supabase
        .from('brand_profiles')
        .select('name,author_name,niches,tone,website_url,contact_email,contact_preference,gear_sections')
        .eq('user_id', user.id)
        .single(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('integrations')
        .select('geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag,tier,subscription_period_start,subscription_period_end')
        .eq('user_id', user.id)
        .single(),
    ])

    const brand = brandResult.data as Record<string, unknown> | null
    const intRow = intResult.data

    // Populate the module-level telemetry context that runAgent reads.
    const tier = normalizeTier(intRow?.tier)
    TELEMETRY = { userId: user.id, tier }

    // Cap gate — metadata generations / billing period. Pre-flight the
    // check so we never fire the 5-agent swarm for a user at cap.
    const metaCap = TIERS[tier].metadataGensPerMonth
    const capCheck = await checkUsageCap(
      supabase, user.id, PRIMARY_FEATURE.metadata, metaCap,
      (intRow?.subscription_period_start as string | null) ?? null,
      (intRow?.subscription_period_end as string | null) ?? null,
    )
    if (capCheck?.exceeded) {
      const next = nextTierFor(tier, 'metadataGensPerMonth')
      const nextHint = next
        ? ` Upgrade to ${next.label} for ${next.limit === null ? 'unlimited' : `${next.limit} / month`}.`
        : ''
      return NextResponse.json({
        error: `You've hit your ${metaCap} metadata generations for this billing period on the ${TIERS[tier].label} plan.${nextHint} Resets ${capCheck.resetLabel}.`,
        limitReached: true,
        cap: 'metadata',
        currentTier: tier,
        upgrade: next ? { tier: next.tier, label: next.label, limit: next.limit } : null,
      }, { status: 429 })
    }

    const brandName = (brand?.name as string) || 'our channel'
    const authorName = (brand?.author_name as string) || ''
    const niches = ((brand?.niches as string[]) || []).join(', ') || 'consumer products'
    const tone = ((brand?.tone as string[]) || []).join(', ') || 'conversational, friendly'
    const websiteUrl = (brand?.website_url as string) || ''
    const contactEmail = (brand?.contact_email as string) || ''
    const contactPreference: 'website' | 'email' =
      (brand?.contact_preference as string) === 'email' ? 'email' : 'website'
    const gearSections = ((brand?.gear_sections as GearSection[]) || []).filter(s => s.title && s.items.length > 0)

    // ── Resolve what to promote when the caller didn't pass an ASIN ───────────
    // Priority (mirrors the blog pipeline; HARD RULE = never blindly Amazon-
    // search when the creator linked the product directly):
    //   1. An Amazon /dp ASIN in the description → Amazon product treatment.
    //   2. A direct store / brand / Geniuslink in the description → promote
    //      THAT link (creators often sell off-Amazon). No Amazon search.
    //   3. Nothing usable → last-resort Amazon discovery by product name.
    let storeUrl: string | null = null          // a non-Amazon product link to promote
    let storeAlreadyGenius = false               // already a geni.us link → keep as-is
    if (!isProduct) {
      const link = await resolveProductLink(videoTitle, videoDescription || '')
      if (link.kind === 'amazon') {
        trimmedAsin = link.asin
        isProduct = true
        productDiscoverySource = 'search'
      } else if (link.kind === 'store') {
        storeUrl = link.url
        storeAlreadyGenius = link.alreadyGeniuslink
      } else {
        // A "Bose QC Ultra review" with no link anywhere still deserves the
        // product treatment — Haiku decides if it's a buyable product, then
        // we scrape Amazon search for the ASIN. Failures fall back to general.
        const discovered = await discoverProductForVideo(videoTitle, videoDescription || '', { userId: user.id, tier })
        if (discovered.asin) {
          trimmedAsin = discovered.asin
          isProduct = true
          productDiscoverySource = discovered.source === 'search' ? 'search' : discovered.source
        }
      }
    }

    // ── Fetch product + build affiliate URL (product mode only) ────────────────
    let product: { asin: string; title: string; bullets: string[]; description: string; price: string | null; rating: string | null; imageUrl: string | null } = {
      asin: trimmedAsin || '', title: videoTitle, bullets: [], description: '', price: null, rating: null, imageUrl: null,
    }
    let affiliateUrl = ''
    let geniuslinkUsed = false
    let geniuslinkError: string | null = null

    if (isProduct) {
      try {
        product = await fetchAmazonProduct(trimmedAsin)
      } catch {
        product = { asin: trimmedAsin, title: videoTitle, bullets: [], description: '', price: null, rating: null, imageUrl: null }
      }

      affiliateUrl = `https://www.amazon.com/dp/${trimmedAsin}`

      if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
        try {
          const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
          affiliateUrl = await genius.createAsinLink(trimmedAsin, product.title || videoTitle)
          geniuslinkUsed = true
        } catch (err) {
          geniuslinkError = err instanceof Error ? err.message : String(err)
          console.error('[generate-metadata] Geniuslink failed:', geniuslinkError)
        }
      }
      if (!geniuslinkUsed && intRow?.amazon_associates_tag) {
        affiliateUrl = `https://www.amazon.com/dp/${trimmedAsin}?tag=${intRow.amazon_associates_tag}`
        // Keep the Geniuslink error visible — fallback to Associates is
        // safe revenue-wise but the user should still know their geni.us
        // link wasn't built so they can investigate (expired keys, group
        // not enabled, etc.). If Geniuslink wasn't configured at all,
        // there's no error to surface and we stay quiet.
        if (geniuslinkError) {
          geniuslinkError = `Geniuslink call failed: ${geniuslinkError}. Used your Amazon Associates tag as fallback.`
        }
      } else if (!geniuslinkUsed && !intRow?.amazon_associates_tag) {
        geniuslinkError = geniuslinkError || 'No affiliate link configured — add Geniuslink or Amazon Associates tag in Site & Integrations'
      }
    } else if (storeUrl) {
      // Non-Amazon direct store / brand link the creator put in the
      // description. Geniuslink wraps ANY destination (not Amazon-only), so
      // we still get tracking. If it's already a geni.us link, keep it.
      if (storeAlreadyGenius) {
        affiliateUrl = storeUrl
        geniuslinkUsed = true
      } else if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
        try {
          const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
          affiliateUrl = await genius.createLink(storeUrl, videoTitle)
          geniuslinkUsed = true
        } catch (err) {
          geniuslinkError = err instanceof Error ? err.message : String(err)
          console.error('[generate-metadata] Geniuslink (store link) failed:', geniuslinkError)
          affiliateUrl = storeUrl // still promote the real product link
        }
      } else {
        affiliateUrl = storeUrl
      }
    }

    // Build subject context for the agent swarm. In product mode this is
    // the Amazon scrape; in general mode it's the video's own metadata.
    const productContext = isProduct
      ? [
          product.title ? `Product: ${product.title}` : '',
          product.price ? `Price: ${product.price}` : '',
          product.rating ? `Rating: ${product.rating}/5` : '',
          product.bullets.length ? `Features:\n${product.bullets.map(b => `- ${b}`).join('\n')}` : '',
          product.description ? `Description: ${product.description}` : '',
          videoDescription ? `Video context: "${videoDescription.slice(0, 200)}"` : '',
        ].filter(Boolean).join('\n')
      : [
          `(General video — no Amazon product attached. Build metadata around the video's topic.)`,
          `Video title: ${videoTitle}`,
          videoDescription ? `Video description / notes: "${videoDescription.slice(0, 800)}"` : '',
        ].filter(Boolean).join('\n')

    // ── Voice anchors: pull this user's 2 most-recently-generated YT
    // metadata blocks so the title / description / pinned-comment
    // agents below match their channel voice over time. Excludes the
    // current video (would self-mirror on re-runs).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: priorMetaRows } = await (supabase as any)
      .from('youtube_videos')
      .select('generated_title,generated_description,generated_pinned_comment,youtube_video_id')
      .eq('user_id', user.id)
      .not('metadata_generated_at', 'is', null)
      .neq('youtube_video_id', youtubeVideoId ?? '__none__')
      .order('metadata_generated_at', { ascending: false })
      .limit(2)
    const priorRows = (priorMetaRows as Array<{
      generated_title: string | null
      generated_description: string | null
      generated_pinned_comment: string | null
    }> | null) ?? []
    const priorTitles = priorRows.map(r => r.generated_title || '').filter(Boolean)
    const priorDescriptions = priorRows.map(r => r.generated_description || '').filter(Boolean)
    const priorPinnedComments = priorRows.map(r => r.generated_pinned_comment || '').filter(Boolean)

    // ── SWARM PHASE 1: Product Analyst + SEO Researcher run in parallel ────────
    const anthropic = createAnthropicClient()

    const [productAnalysis, seoData] = await Promise.all([
      productAnalystAgent(anthropic, productContext, videoTitle, niches, isProduct),
      seoResearcherAgent(anthropic, productContext, videoTitle, niches, [], isProduct),
    ])

    // ── SWARM PHASE 2: Title + Content + Engagement run in parallel ───────────
    // (Title strategist gets product analysis context; content + engagement agents get title)
    const titleResult = await titleStrategistAgent(
      anthropic, productContext, videoTitle, tone, productAnalysis, isProduct, priorTitles,
    )

    // ── Internal title scoring (Phase 2 / Track A) ────────────────────────────
    // The swarm proposes a "best" + 4 alternatives, but that pick is an
    // unscored LLM guess. Score all 5 candidates on CTR-predictive factors
    // (curiosity, clarity, keyword-near-front, ≤60 chars) and promote the
    // strongest. Runs BEFORE the content + engagement agents so the
    // description and pinned comment are built around the title we actually
    // ship. Best-effort: scoreTitle returns null on failure, so a total
    // scoring failure leaves the swarm's own pick untouched.
    const titleKeyword = productAnalysis.keywords?.[0]
    let titleScores: Array<{ title: string; score: number; verdict: string }> = []
    {
      const candidates = Array.from(
        new Set([titleResult.best, ...titleResult.alternatives].map(t => (t || '').trim()).filter(Boolean)),
      )
      const scored = await Promise.all(
        candidates.map(async title => ({ title, s: await scoreTitle(title, { keyword: titleKeyword, ctx: { userId: user.id, tier } }) })),
      )
      const ranked = scored
        .filter(r => r.s !== null)
        .sort((a, b) => (b.s?.score ?? 0) - (a.s?.score ?? 0))
      if (ranked.length > 0) {
        const winner = ranked[0].title
        const rankedRest = ranked.slice(1).map(r => r.title)
        // Preserve any candidates we couldn't score at the tail so nothing is lost.
        const unscored = candidates.filter(c => c !== winner && !ranked.some(r => r.title === c))
        titleResult.best = winner
        titleResult.alternatives = [...rankedRest, ...unscored]
        titleScores = ranked.map(r => ({ title: r.title, score: r.s?.score ?? 0, verdict: r.s?.verdict ?? '' }))
      }
    }

    const [contentResult, engagementResult] = await Promise.all([
      contentWriterAgent(anthropic, productAnalysis, titleResult.best, tone, niches, isProduct, priorDescriptions),
      engagementAgent(anthropic, titleResult.best, productAnalysis, affiliateUrl, tone, priorPinnedComments),
    ])

    // ── Guarantee the affiliate URL is verbatim in the pinned comment ─────────
    // (Product mode only — general videos don't have a URL to enforce.)
    if (affiliateUrl && engagementResult.pinnedComment && !engagementResult.pinnedComment.includes(affiliateUrl)) {
      engagementResult.pinnedComment = engagementResult.pinnedComment.trimEnd() + '\n' + affiliateUrl
    }

    // ── FTC disclosure ────────────────────────────────────────────────────────
    // Affiliate / sponsored content must be labelled. Append "#ad #sponsored"
    // at the very end of the pinned comment (product mode only), unless an
    // equivalent disclosure is already present.
    if (affiliateUrl && engagementResult.pinnedComment) {
      const lc = engagementResult.pinnedComment.toLowerCase()
      if (!lc.includes('#ad') && !lc.includes('#sponsored')) {
        engagementResult.pinnedComment = engagementResult.pinnedComment.trimEnd() + '\n\n#ad #sponsored'
      }
    }

    // ── Assemble description ──────────────────────────────────────────────────
    // Honor the creator's explicit preference (Brand Profile → Brand
     // Outreach Contact). Fall back to whichever channel they actually
     // filled in if the preferred one is empty.
    const collabLine = (() => {
      if (contactPreference === 'email' && contactEmail) {
        return `Let's Work Together! Email me for collaborations: ${contactEmail}`
      }
      if (contactPreference === 'website' && websiteUrl) {
        return `Let's Work Together! Check my WEBSITE for collaborations: ${websiteUrl}`
      }
      if (websiteUrl) return `Let's Work Together! Check my WEBSITE for collaborations: ${websiteUrl}`
      if (contactEmail) return `Let's Work Together! Email me for collaborations: ${contactEmail}`
      return ''
    })()

    const gearBlock = gearSections.map(section => {
      const itemLines = section.items
        .filter(i => i.name && i.url)
        .map(i => `${i.name}: ${i.url}`)
        .join('\n')
      return `${section.title}: (Amazon affiliate links)\n${itemLines}`
    }).join('\n\n')

    // Description assembly differs by mode. Product mode leads with the
    // affiliate link + disclosure; general mode opens straight with the
    // video summary and skips the affiliate / ASIN / disclaimer block.
    const descParts: string[] = []
    if (isProduct) {
      descParts.push(
        `Check Today's Price and Availability on AMAZON here: ${affiliateUrl}`,
        `(affiliate link)`,
        `----------`,
        `Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.`,
        seoData.hashtags,
        `----------`,
        `Thank you for watching! If you enjoyed this video review and found it useful, please subscribe and like for more product reviews :)`,
      )
    } else {
      descParts.push(
        contentResult.productDescription,
        ``,
        seoData.hashtags,
        `----------`,
        `Thanks for watching! If this was useful, hit subscribe + like — it really helps the channel.`,
      )
    }
    // Blog backlink — creates a loop between every YouTube video and the user's
    // blog. Read from their saved Blog URL (brand_profiles.website_url). Skipped
    // when the user hasn't set one.
    if (websiteUrl) {
      descParts.push(`----------`, `For more in depth reviews, make sure to check out my blog: ${websiteUrl}`)
    }
    if (collabLine) descParts.push(`----------`, collabLine)
    if (isProduct) {
      descParts.push(`----------`, `Product ASIN: ${trimmedAsin}`, `----------`, `Product Description:`, contentResult.productDescription)
    }
    if (gearBlock) descParts.push(`----------`, gearBlock)

    const description = descParts.join('\n')

    // ── Persist generated metadata for the voice-anchor loop ─────────────────
    // Best-effort write — telemetry-style, never fails the request.
    if (youtubeVideoId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('youtube_videos')
          .update({
            generated_title: titleResult.best,
            generated_description: description,
            generated_pinned_comment: engagementResult.pinnedComment,
            generated_tags: seoData.tags,
            metadata_generated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('youtube_video_id', youtubeVideoId)
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      ok: true,
      asin: trimmedAsin || null,
      isProduct,
      productDiscoverySource,
      affiliateUrl,
      geniuslinkUsed,
      geniuslinkError,
      agentInsights: {
        targetBuyer: productAnalysis.targetBuyer,
        topBenefits: productAnalysis.topBenefits,
        painPoints: productAnalysis.painPoints,
      },
      product: {
        title: product.title,
        price: product.price,
        rating: product.rating,
        imageUrl: product.imageUrl,
      },
      productBullets: product.bullets,
      productDescription: contentResult.productDescription,
      generated: {
        title: titleResult.best,
        description,
        tags: seoData.tags,
        pinnedComment: engagementResult.pinnedComment,
        title_alternatives: titleResult.alternatives,
        title_scores: titleScores,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-metadata swarm]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
