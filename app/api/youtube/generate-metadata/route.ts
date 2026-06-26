import { NextResponse } from 'next/server'
import { scrubBanned } from '@/lib/scrub'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct } from '@/services/amazon'
import { discoverProductForVideo } from '@/lib/product-detect'
import { resolveProductLink } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { resolveGeniuslinkYouTubeGroupId, appendAmazonSubtag, YOUTUBE_COPILOT_GROUP_NAME } from '@/lib/geniuslink-group'
import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { TIERS, nextTierFor, normalizeTier, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { scoreTitle } from '@/lib/thumbnail-score'

export const maxDuration = 120

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

// ── Retry wrapper for Anthropic 529 overloaded errors ────────────────────────
/**
 * Sanity-check that the Amazon product the ASIN resolves to is actually
 * what the video is about. Catches the common footgun: a user typos one
 * char of their hair-mask ASIN, MVP fetches a phone case, and writes
 * the entire description + thumbnail + tags around the phone case.
 *
 * Heuristic: tokenize product side (title + first 2 bullets) and video
 * side (title + first 400 chars of description). Strip stop words +
 * very short tokens. Require at least ONE shared meaningful token to
 * consider it a match. Returns null on match, or a list of distinguishing
 * tokens from each side on mismatch (so the error message can be specific).
 *
 * Permissive on purpose — generic words like "review", "best", "2026"
 * already get stripped, so even a one-word product noun match passes.
 * The point is to catch the dramatic mismatches (hair mask vs phone
 * case), not punish loose phrasing.
 */
function verifyAsinMatchesVideo(
  productTitle: string,
  productBullets: string[],
  videoTitle: string,
  videoDescription: string,
): { match: true } | { match: false; productWords: string[]; videoWords: string[] } {
  const STOP = new Set([
    'a','an','the','this','that','these','those','it','its','for','of','to','in','on','with','and','or','but','by','at','from',
    'is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would','could','should','can',
    'i','you','we','he','she','they','your','my','our','their','his','her','them',
    'review','reviews','reviewing','reviewed','test','tested','testing','best','top','vs','versus','any','new','old',
    'amazon','product','products','model','item','items','unboxing','demo','tutorial','guide','how','what','why','when','where',
    'video','watch','channel','subscribe','like','share','today','now','first','last','really','actually','just','also','full',
    '2024','2025','2026','2027','part','one','two','three','full','small','large','big','medium',
    // 3-letter grammatical filler — listed so lowering the length floor to 3 (to catch real
    // short product nouns like "bag", "cup", "pen", "kit", "fan", "mat", "jar", "lid") stays clean.
    'get','got','let','out','off','too','way','lot','use','put','via','per','all','not','but','was',
  ])
  const tokenize = (s: string): Set<string> => {
    const out = new Set<string>()
    for (const raw of (s || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw) continue
      if (raw.length < 3) continue // 3, not 4 — so real short nouns count ("bag","cup","pen","kit","fan","mat","jar","lid","pcs")
      if (/^[a-z0-9]{10}$/.test(raw)) continue // ASIN-shaped junk
      if (/^\d+$/.test(raw)) continue
      if (STOP.has(raw)) continue
      out.add(raw)
    }
    return out
  }
  const productText = `${productTitle} ${(productBullets ?? []).slice(0, 2).join(' ')}`
  const videoText = `${videoTitle} ${(videoDescription ?? '').slice(0, 400)}`
  const productTokens = tokenize(productText)
  const videoTokens = tokenize(videoText)
  // Either side empty (e.g. Amazon scrape returned no title) — can't judge, pass.
  if (productTokens.size === 0 || videoTokens.size === 0) return { match: true }
  for (const t of productTokens) {
    if (videoTokens.has(t)) return { match: true }
  }
  return {
    match: false,
    productWords: Array.from(productTokens).slice(0, 5),
    videoWords: Array.from(videoTokens).slice(0, 5),
  }
}

// maxAttempts kept LOW + backoff capped LOW on purpose: this route runs a
// multi-agent swarm (~4 sequential Claude stages) inside a 120s function. The
// old 8 attempts × up-to-15s backoff (~70s/call) could stack across stages and
// blow the budget → the function TIMED OUT → Vercel returned a generic "Internal
// Server Error" page instead of our clean "Claude temporarily unavailable" JSON.
// 4 × ≤7s keeps the worst case well under 120s so a real Anthropic blip surfaces
// fast + clearly (and a recovered Anthropic just succeeds on retry). (2026-06-10)
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let delay = 1500
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Record<string, unknown>)?.status as number | undefined
      const msg = err instanceof Error ? err.message : String(err)
      // 2026-06-08: retry on transient upstream failures, not just 529 overloaded.
      // Anthropic SDK surfaces InternalServerError with msg="Internal Server
      // Error" and status=500. Previously bubbled raw to UI — same bug fix as
      // 61f7bc8 applied to /api/blog/generate, and 2026-06-08 to the twin
      // /api/youtube/generate-thumbnail route.
      const lower = msg.toLowerCase()
      const isTransient = status === 529 || status === 500 || status === 502 || status === 503
        || lower.includes('overloaded')
        || lower.includes('internal server error')
        || /\b5\d\d\b/.test(msg)
      if (!isTransient || attempt === maxAttempts) {
        if (isTransient) throw new Error('Claude AI is temporarily unavailable (upstream returned ' + (status || '5xx') + '). Please retry in a moment.')
        throw err
      }
      console.warn(`[anthropic-retry] transient (status=${status ?? '?'}, msg=${msg.slice(0, 80)}), attempt ${attempt}/${maxAttempts}, waiting ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 7000)
    }
  }
  throw new Error('Claude AI is temporarily unavailable — please try again in a moment.')
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
    maxTokens: 700,
    feature: 'yt_meta_title_strategist',
    system: 'You are a viral YouTube title strategist. You write titles that dominate search and maximise click-through rate. Your titles READ LIKE A REAL CREATOR WROTE THEM ABOUT THIS SPECIFIC PRODUCT — never templated, never generic. Return ONLY valid JSON.',
    user: `Write 5 viral YouTube title options for this ${isProduct ? 'product review' : 'video (not a product review — it is general content)'}.

${isProduct ? 'PRODUCT' : 'VIDEO CONTEXT'}: ${productContext}
ORIGINAL TITLE: "${videoTitle}"
${isProduct ? 'TARGET BUYER' : 'TARGET VIEWER'}: ${productAnalysis.targetBuyer}
${isProduct ? 'TOP BENEFITS' : 'KEY TAKEAWAYS'}: ${productAnalysis.topBenefits.join(' • ')}
${isProduct ? 'PAIN POINTS' : 'VIEWER QUESTIONS'}: ${productAnalysis.painPoints.join(' • ')}
TONE: ${tone}

CORE PRINCIPLES (do not violate):
1. EACH title must be GROUNDED in a SPECIFIC benefit, pain point, or moment from the analysis above. Quote a real number, a real result, a real before/after — never generic "Honest Review" filler.
2. EACH of the 5 alternatives must use a STRUCTURALLY DIFFERENT opening. If alt #1 starts with "I Tested…", #2 cannot start with "I Tried…" or "I Tested…". If #1 is a question, #2 must be a statement. The 5 titles together should read as 5 distinct creators wrote them.
3. NO TEMPLATED HOOKS. The following openings are BANNED across all 5 outputs because they've been overused: "Worth It?", "Before You Buy", "Don't Buy Until", "Real Talk", "Watch This First", "Is It Worth It?", "I Tested … for 30 Days", "The Truth About…", "What Nobody Tells You", "Here's What Happened When".
4. NEVER use the word "honest" anywhere.

ALLOWED ANGLES (mix across the 5 — never use the same angle twice):
- Specific-result hook: lead with a number/outcome from the analysis ("I Slept 8 Hours After Years of Insomnia — Here's What Did It")
- Counter-intuitive setup: contradict an assumption ("This $30 Diffuser Replaced My $200 Sleep Routine")
- Surprised-curiosity: a thing the creator didn't expect ("I Was Wrong About Aromatherapy Until I Tried This")
- Direct-benefit headline: state the payoff plainly ("Cortisol Manager Cut My Stress in Half — Here's How")
- Comparative / vs: contrast with an alternative ("Ashwagandha Tea vs Cortisol Manager — Which Actually Works?")
- Question grounded in the pain point: ("Can a Supplement Really Fix Stress-Induced Insomnia?")
- Story snapshot: ("The Week I Switched to Cortisol Manager — and Stopped Waking at 3 AM")
- Skeptic-to-believer arc: ("I Didn't Buy The Hype About Cortisol Manager. Then Week 3 Happened.")

${isProduct ? '- Include the product name once where it lands naturally — never wedge it in if it ruins the flow.' : '- Make the video topic unmissable in the title.'}
- Under 100 characters each
- No ASIN, no hashtags, no emojis

Return JSON:
{
  "best": "the single strongest title — the one most likely to drive clicks",
  "alternatives": ["4 OTHER strong titles, each STRUCTURALLY DIFFERENT from each other and from 'best'"]
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
    // 2026-06-09 Phase 2 (VA): resource reads use ownerId so VAs see the
    // owner's brand + integrations + history; usage cap + telemetry use
    // user.id so we bill the actual caller.
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { user, ownerId } = auth

    const { asin, videoTitle, videoDescription, youtubeVideoId, skipAsinCheck = false } = await request.json() as {
      asin?: string | null
      videoTitle: string
      videoDescription?: string
      /** YouTube native ID (e.g. dQw4w9WgXcQ). Used to persist
       *  generated metadata back to youtube_videos for the voice-
       *  anchor loop. Optional — generation still works without it. */
      youtubeVideoId?: string | null
      /** Set by the UI's "Generate anyway" button to bypass the ASIN-mismatch
       *  tripwire when the creator confirms the product is right (the word-overlap
       *  heuristic can false-fire on casual titles vs keyword-stuffed Amazon titles). */
      skipAsinCheck?: boolean
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

    // ── Fetch brand + credentials (+ this video's already-resolved product
    //    link, if it was blogged) in parallel ──────────────────────────────────
    const [brandResult, intResult, videoRowResult] = await Promise.all([
      supabase
        .from('brand_profiles')
        .select('name,author_name,niches,tone,website_url,contact_email,contact_preference,gear_sections')
        .eq('user_id', ownerId)
        .single(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase
        .from('integrations')
        .select('geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag,tier,subscription_period_start,subscription_period_end')
        .eq('user_id', ownerId)
        .single(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      youtubeVideoId
        ? (supabase as any)
            .from('youtube_videos')
            .select('id,product_url')
            .eq('user_id', ownerId)
            .eq('youtube_video_id', youtubeVideoId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const brand = brandResult.data as Record<string, unknown> | null
    const intRow = intResult.data
    // The affiliate/product link the blog already resolved for this video (stored
    // on youtube_videos.product_url at blog time). Reused so a REVIEW video keeps
    // its affiliate link + disclaimer in the YouTube description even when the
    // draft has no ASIN in the title and live discovery is unsure — exactly the
    // "any video works, no ASIN needed" promise.
    const storedProductUrl = ((videoRowResult?.data as { product_url?: string | null } | null)?.product_url || '').trim()

    // Bulletproof fallback: if no product_url is stored, pull the affiliate link
    // straight out of THIS video's published blog post (it's guaranteed present
    // for a review). This guarantees a blogged product video keeps PRODUCT mode
    // even when the YouTube draft has no ASIN/link and product_url was never set.
    let reusableProductLink = storedProductUrl
    if (!reusableProductLink) {
      const internalVideoId = (videoRowResult?.data as { id?: string | null } | null)?.id || null
      if (internalVideoId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: bp } = await (supabase as any)
            .from('blog_posts')
            .select('content')
            .eq('video_id', internalVideoId)
            .not('content', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const content = (bp?.content as string | null) || ''
          // First Geniuslink or Amazon product URL in the post = the CTA link.
          const m = content.match(/https?:\/\/(?:geni\.us|gnz\.[a-z]+|(?:[\w-]+\.)*amazon\.[a-z.]+)\/[^\s"'<>)]+/i)
          if (m) reusableProductLink = m[0]
        } catch { /* no post / not readable — fall through to live discovery */ }
      }
    }

    // Populate the module-level telemetry context that runAgent reads.
    const tier = normalizeTier(intRow?.tier)
    TELEMETRY = { userId: user.id, tier }

    // Co-Pilot metadata is FREE enrichment of a content piece (pricing model
    // 2026-06-15) — off the content-piece quota, bounded by the monthly
    // $-ceiling instead. Pre-flight so we never fire the 5-agent swarm when a
    // user has already blown their spend ceiling.
    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked

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
      // Append the reused product link (from product_url or the blog post) so a
      // REVIEW keeps product mode (affiliate link + disclaimer) even when the
      // YouTube draft has no link.
      const descForResolution = `${videoDescription || ''}\n${reusableProductLink}`.trim()
      const link = await resolveProductLink(videoTitle, descForResolution)
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

      // 2026-06-09: ASIN-mismatch tripwire. Block early if the fetched
      // Amazon product clearly isn't what the video is about — saves the
      // agent-swarm token cost AND prevents the worst-case footgun
      // (publishing a phone-case description on a hair-mask video). Only
      // runs when we got a real product back from Amazon — when the
      // scrape returns the videoTitle as a fallback, the heuristic
      // would always match itself and the check is moot. Only enforced
      // when the user EXPLICITLY supplied the ASIN; auto-discovered
      // ASINs (via title search) trust the discovery's match score.
      if (
        !skipAsinCheck
        && productDiscoverySource === 'caller'
        && product.title
        && product.title !== videoTitle
      ) {
        const verdict = verifyAsinMatchesVideo(
          product.title,
          product.bullets,
          videoTitle,
          videoDescription || '',
        )
        if (!verdict.match) {
          return NextResponse.json({
            error:
              `That ASIN (${trimmedAsin}) points to "${product.title.slice(0, 80)}", which doesn't seem to match your video. ` +
              `Distinctive words in the product: ${verdict.productWords.join(', ')}. ` +
              `Distinctive words in your video: ${verdict.videoWords.join(', ')}. ` +
              `Double-check the ASIN in your title — one wrong character can land you on a totally different product.`,
            asinMismatch: true,
            productTitle: product.title,
            productWords: verdict.productWords,
            videoWords: verdict.videoWords,
          }, { status: 422 })
        }
      }

      // 2026-06-09: YT Co-Pilot routes EVERY description link to the
      // per-user "MVP-YOUTUBE" Geniuslink group — never the per-site
      // group used by /api/blog/generate. The split lets the creator
      // tell at a glance whether a click came from a YouTube
      // description (MVP-YOUTUBE) or from a blog post (their site's
      // own group, e.g. "gominreviews.com"). Per-video earnings still
      // attribute via ascsubtag={youtubeVideoId} so Amazon Associates
      // shows revenue per video too.
      const linkNote = youtubeVideoId
        ? `${youtubeVideoId} | ${YOUTUBE_COPILOT_GROUP_NAME}`
        : (product.title || videoTitle)
      const subtaggedDest = appendAmazonSubtag(`https://www.amazon.com/dp/${trimmedAsin}`, youtubeVideoId)
      affiliateUrl = subtaggedDest

      if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
        const groupId = await resolveGeniuslinkYouTubeGroupId({
          supabase,
          userId: ownerId,
          apiKey: intRow.geniuslink_api_key,
          apiSecret: intRow.geniuslink_api_secret,
        })
        try {
          const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
          affiliateUrl = await genius.createLink(subtaggedDest, product.title || videoTitle, {
            groupId: groupId ?? undefined,
            note: linkNote,
          })
          geniuslinkUsed = true
        } catch (err) {
          geniuslinkError = err instanceof Error ? err.message : String(err)
          console.error('[generate-metadata] Geniuslink failed:', geniuslinkError)
        }
      }
      if (!geniuslinkUsed && intRow?.amazon_associates_tag) {
        affiliateUrl = appendAmazonSubtag(
          `https://www.amazon.com/dp/${trimmedAsin}?tag=${intRow.amazon_associates_tag}`,
          youtubeVideoId,
        )
        // Keep the Geniuslink error visible — fallback to Associates is
        // safe revenue-wise but the user should still know their geni.us
        // link wasn't built so they can investigate (expired keys, group
        // not enabled, etc.). If Geniuslink wasn't configured at all,
        // there's no error to surface and we stay quiet.
        if (geniuslinkError) {
          geniuslinkError = `Geniuslink call failed: ${geniuslinkError}. Used your Amazon Associates tag as fallback.`
        }
      } else if (!geniuslinkUsed && !intRow?.amazon_associates_tag) {
        geniuslinkError = geniuslinkError || 'No affiliate link configured — add Geniuslink or Amazon Associates tag in Brand Profile → Affiliate Link Routing'
      }
    } else if (storeUrl) {
      // Non-Amazon direct store / brand link the creator put in the
      // description. Geniuslink wraps ANY destination (not Amazon-only), so
      // we still get tracking. If it's already a geni.us link, keep it.
      if (storeAlreadyGenius) {
        affiliateUrl = storeUrl
        geniuslinkUsed = true
      } else if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
        // YT Co-Pilot path → MVP-YOUTUBE group (see Amazon branch above).
        const linkNote = youtubeVideoId
          ? `${youtubeVideoId} | ${YOUTUBE_COPILOT_GROUP_NAME}`
          : videoTitle
        const groupId = await resolveGeniuslinkYouTubeGroupId({
          supabase,
          userId: ownerId,
          apiKey: intRow.geniuslink_api_key,
          apiSecret: intRow.geniuslink_api_secret,
        })
        try {
          const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
          affiliateUrl = await genius.createLink(storeUrl, videoTitle, {
            groupId: groupId ?? undefined,
            note: linkNote,
          })
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
    const { data: priorMetaRows } = await supabase
      .from('youtube_videos')
      .select('generated_title,generated_description,generated_pinned_comment,youtube_video_id')
      .eq('user_id', ownerId)
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

    // Description assembly differs by mode. Any video that resolved an
    // affiliate / product link leads with that link + disclosure; general
    // mode (no link at all) opens straight with the video summary.
    const descParts: string[] = []
    if (affiliateUrl) {
      const shopLabel = isProduct ? 'AMAZON' : 'the product'
      const disclosureLine = isProduct
        ? `Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.`
        : `Disclosure: This video contains affiliate links. I may earn a commission at no extra cost to you.`
      descParts.push(
        `Check Today's Price and Availability on ${shopLabel} here: ${affiliateUrl}`,
        `(affiliate link)`,
        `----------`,
        disclosureLine,
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
    //
    // 2026-06-08: this .update() silently no-ops for Co-Pilot users whose
    // youtube_videos row doesn't exist yet (same population as the Co-Pilot
    // push tracking bug — only /api/youtube/sync populates that table). The
    // voice-anchor loop then never learns from their metadata generations.
    // Use .select() to detect 0-rows and warn so we know if this regresses.
    // Extract the geni.us shortcode from the YT-side Geniuslink so the
    // /analytics page can attribute YouTube-description clicks to the
    // MVP-YOUTUBE group. Falls back to null when the user has no
    // Geniuslink keys (affiliateUrl is the raw Amazon URL in that case).
    const ytGeniuslinkCode = affiliateUrl.match(/https?:\/\/(?:www\.)?geni\.us\/([A-Za-z0-9]+)/)?.[1] ?? null

    if (youtubeVideoId) {
      try {
        // Cast through `any` because the regenerated DB types lag
        // migration 114 (which added geniuslink_yt_code). Same pattern
        // as the per-site Geniuslink group write in lib/geniuslink-group.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: updated, error: updErr } = await (supabase as any)
          .from('youtube_videos')
          .update({
            generated_title: titleResult.best,
            generated_description: description,
            generated_pinned_comment: engagementResult.pinnedComment,
            generated_tags: seoData.tags,
            metadata_generated_at: new Date().toISOString(),
            // Only write when we actually got a code — preserves any prior
            // code if this generation fell back to the raw Amazon URL.
            ...(ytGeniuslinkCode ? { geniuslink_yt_code: ytGeniuslinkCode } : {}),
            // Remember the product we resolved (the raw destination) so a LATER
            // regeneration stays in product mode even after the first Apply
            // replaced the ASIN-bearing draft title with the clean SEO title.
            // Only when we resolved one AND nothing's stored yet — never clobber
            // the blog's canonical product_url.
            ...((trimmedAsin || storeUrl) && !storedProductUrl
              ? { product_url: trimmedAsin ? `https://www.amazon.com/dp/${trimmedAsin}` : storeUrl }
              : {}),
          })
          .eq('user_id', ownerId)
          .eq('youtube_video_id', youtubeVideoId)
          .select('id')
        if (updErr) {
          console.warn('[generate-metadata] persist failed:', updErr.message)
        } else if (!updated || updated.length === 0) {
          console.warn('[generate-metadata] persist no-op: no youtube_videos row for', youtubeVideoId, '— Co-Pilot user without sync? Voice-anchor loop will skip this generation.')
        }
      } catch (err) {
        console.warn('[generate-metadata] persist threw:', err instanceof Error ? err.message : String(err))
      }
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
      // Scrub banned words from every string the user PUBLISHES to YouTube
      // (title/description/tags/pinned comment) — the "never HONEST" rule etc.
      // applies to live metadata, not just blog content.
      generated: {
        title: scrubBanned(titleResult.best),
        description: scrubBanned(description),
        tags: (seoData.tags || []).map((t: string) => scrubBanned(t)),
        pinnedComment: scrubBanned(engagementResult.pinnedComment),
        title_alternatives: (titleResult.alternatives || []).map((t: string) => scrubBanned(t)),
        title_scores: titleScores,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-metadata swarm]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
