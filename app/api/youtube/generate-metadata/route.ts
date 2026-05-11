import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct } from '@/services/amazon'
import { createGeniuslinkService } from '@/services/geniuslink'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

// ── Agent runner helper ───────────────────────────────────────────────────────
async function runAgent(
  anthropic: Anthropic,
  opts: { model: string; system: string; user: string; maxTokens?: number }
): Promise<string> {
  const msg = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  })
  return (msg.content[0] as { type: string; text: string }).text.trim()
}

function parseJSON<T>(raw: string, fallback: T): T {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return fallback
  try { return JSON.parse(match[0]) as T } catch { return fallback }
}

// ── AGENT 1: Product Analyst ──────────────────────────────────────────────────
async function productAnalystAgent(
  anthropic: Anthropic,
  productContext: string,
  videoTitle: string,
  niches: string,
): Promise<{ targetBuyer: string; topBenefits: string[]; painPoints: string[]; keywords: string[] }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 800,
    system: 'You are a product research specialist. Analyse Amazon products for YouTube content. Return ONLY valid JSON.',
    user: `Analyse this product for a YouTube review in the "${niches}" niche.

PRODUCT DATA:
${productContext}

VIDEO TITLE: "${videoTitle}"

Return JSON:
{
  "targetBuyer": "one sentence describing the ideal customer",
  "topBenefits": ["top 3 benefits that drive purchase decisions"],
  "painPoints": ["top 3 problems this product solves"],
  "keywords": ["10 exact search terms buyers type into YouTube/Google for this product — plain words only, no special characters"]
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
): Promise<{ best: string; alternatives: string[] }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 600,
    system: 'You are a viral YouTube title strategist. You write titles that dominate search and maximise click-through rate. Return ONLY valid JSON.',
    user: `Write 5 viral YouTube title options for this product review.

PRODUCT: ${productContext}
ORIGINAL TITLE: "${videoTitle}"
TARGET BUYER: ${productAnalysis.targetBuyer}
TOP BENEFITS: ${productAnalysis.topBenefits.join(', ')}
PAIN POINTS: ${productAnalysis.painPoints.join(', ')}
TONE: ${tone}

TITLE RULES:
- Lead with a power hook: "Honest Review", "Worth It?", "Before You Buy", "I Tested", "Don't Buy Until..."
- Include the exact product name people search for
- Add an emotional trigger or specific benefit
- Under 100 characters
- No ASIN, no hashtags, no emojis

Return JSON:
{
  "best": "the single strongest title",
  "alternatives": ["4 other strong options"]
}`,
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
): Promise<{ tags: string[]; hashtags: string }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 900,
    system: 'You are a YouTube SEO expert. You research high-traffic keywords and trending hashtags. Return ONLY valid JSON.',
    user: `Generate maximum-reach YouTube tags and hashtags for this product review.

PRODUCT: ${productContext}
VIDEO TITLE: "${videoTitle}"
NICHE: ${niches}
KNOWN KEYWORDS: ${productKeywords.join(', ')}

RULES:
- Tags: plain text only, NO special characters (#"[]{}()), NO emojis, each tag under 30 words
- Hashtags: include #ad #affiliate #productreview plus 15-19 niche-specific ones, space-separated
- Mix: brand name, product type, use case, comparison terms, problem-solution terms, broad category

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
): Promise<{ productDescription: string }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 600,
    system: 'You are a YouTube content writer who optimises descriptions for AI answer engines (ChatGPT, Gemini, Perplexity). Return ONLY valid JSON.',
    user: `Write a product description optimised for YouTube, Google, and AI search engines.

VIDEO TITLE: "${bestTitle}"
TARGET BUYER: ${productAnalysis.targetBuyer}
TOP BENEFITS: ${productAnalysis.topBenefits.join(', ')}
PAIN POINTS SOLVED: ${productAnalysis.painPoints.join(', ')}
TONE: ${tone}
NICHE: ${niches}

RULES:
- 3-4 sentences maximum
- Answer: What is it? Who is it for? What is the #1 benefit? Is it worth buying?
- Use natural search language — write how people TALK, not how brands write
- Optimised for AI answer engines to feature in results
- No hashtags, no links, no special characters

Return JSON:
{
  "productDescription": "3-4 sentences..."
}`,
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
): Promise<{ pinnedComment: string }> {
  const raw = await runAgent(anthropic, {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 400,
    system: 'You are a YouTube engagement specialist who writes high-converting pinned comments. Return ONLY valid JSON.',
    user: `Write a pinned comment for this YouTube video that drives clicks and engagement.

VIDEO TITLE: "${bestTitle}"
TARGET BUYER: ${productAnalysis.targetBuyer}
TOP BENEFIT: ${productAnalysis.topBenefits[0] || 'great value'}
AFFILIATE LINK: ${affiliateUrl}
TONE: ${tone}

RULES:
- 2-3 punchy sentences
- Start with a hook or key insight from the video
- Include the affiliate link naturally
- End with a CTA (check price, grab yours, limited stock, etc.)
- Feel human and conversational — not salesy

Return JSON:
{
  "pinnedComment": "2-3 sentence pinned comment with link..."
}`,
  })
  return parseJSON(raw, { pinnedComment: '' })
}

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { asin, videoTitle, videoDescription } = await request.json() as {
      asin: string
      videoTitle: string
      videoDescription?: string
    }

    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json({ error: 'Invalid ASIN' }, { status: 400 })
    }

    // ── Fetch brand + credentials in parallel ─────────────────────────────────
    const [brandResult, intResult] = await Promise.all([
      supabase
        .from('brand_profiles')
        .select('name,author_name,niches,tone,website_url,contact_email,gear_sections')
        .eq('user_id', user.id)
        .single(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('integrations')
        .select('geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
        .eq('user_id', user.id)
        .single(),
    ])

    const brand = brandResult.data as Record<string, unknown> | null
    const intRow = intResult.data

    const brandName = (brand?.name as string) || 'our channel'
    const authorName = (brand?.author_name as string) || ''
    const niches = ((brand?.niches as string[]) || []).join(', ') || 'consumer products'
    const tone = ((brand?.tone as string[]) || []).join(', ') || 'conversational, friendly'
    const websiteUrl = (brand?.website_url as string) || ''
    const contactEmail = (brand?.contact_email as string) || ''
    const gearSections = ((brand?.gear_sections as GearSection[]) || []).filter(s => s.title && s.items.length > 0)

    // ── Fetch product + build affiliate URL in parallel ───────────────────────
    let product: { asin: string; title: string; bullets: string[]; description: string; price: string | null; rating: string | null; imageUrl: string | null }
    try {
      product = await fetchAmazonProduct(asin)
    } catch {
      product = { asin, title: videoTitle, bullets: [], description: '', price: null, rating: null, imageUrl: null }
    }

    let affiliateUrl = `https://www.amazon.com/dp/${asin}`
    let geniuslinkUsed = false
    let geniuslinkError: string | null = null

    if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        affiliateUrl = await genius.createAsinLink(asin, product.title || videoTitle)
        geniuslinkUsed = true
      } catch (err) {
        geniuslinkError = err instanceof Error ? err.message : String(err)
      }
    }
    if (!geniuslinkUsed && intRow?.amazon_associates_tag) {
      affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${intRow.amazon_associates_tag}`
      geniuslinkError = null
    } else if (!geniuslinkUsed && !intRow?.amazon_associates_tag) {
      geniuslinkError = geniuslinkError || 'No affiliate link configured — add Geniuslink or Amazon Associates tag in Site & Integrations'
    }

    const productContext = [
      product.title ? `Product: ${product.title}` : '',
      product.price ? `Price: ${product.price}` : '',
      product.rating ? `Rating: ${product.rating}/5` : '',
      product.bullets.length ? `Features:\n${product.bullets.map(b => `- ${b}`).join('\n')}` : '',
      product.description ? `Description: ${product.description}` : '',
      videoDescription ? `Video context: "${videoDescription.slice(0, 200)}"` : '',
    ].filter(Boolean).join('\n')

    // ── SWARM PHASE 1: Product Analyst + SEO Researcher run in parallel ────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const [productAnalysis, seoData] = await Promise.all([
      productAnalystAgent(anthropic, productContext, videoTitle, niches),
      seoResearcherAgent(anthropic, productContext, videoTitle, niches, []),
    ])

    // ── SWARM PHASE 2: Title + Content + Engagement run in parallel ───────────
    // (Title strategist gets product analysis context; content + engagement agents get title)
    const titleResult = await titleStrategistAgent(
      anthropic, productContext, videoTitle, tone, productAnalysis,
    )

    const [contentResult, engagementResult] = await Promise.all([
      contentWriterAgent(anthropic, productAnalysis, titleResult.best, tone, niches),
      engagementAgent(anthropic, titleResult.best, productAnalysis, affiliateUrl, tone),
    ])

    // ── Assemble description ──────────────────────────────────────────────────
    const collabLine = websiteUrl
      ? `Let's Work Together! Check my WEBSITE for collaborations: ${websiteUrl}`
      : contactEmail
        ? `Let's Work Together! Email me for collaborations: ${contactEmail}`
        : ''

    const gearBlock = gearSections.map(section => {
      const itemLines = section.items
        .filter(i => i.name && i.url)
        .map(i => `${i.name}: ${i.url}`)
        .join('\n')
      return `${section.title}: (Amazon affiliate links)\n${itemLines}`
    }).join('\n\n')

    const descParts = [
      `Check Today's Price and Availability on AMAZON here: ${affiliateUrl}`,
      `(affiliate link)`,
      `----------`,
      `Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.`,
      seoData.hashtags,
      `----------`,
      `Thank you for watching! If you enjoyed this video review and found it useful, please subscribe and like for more product reviews :)`,
    ]
    if (collabLine) descParts.push(`----------`, collabLine)
    descParts.push(`----------`, `Product ASIN: ${asin}`, `----------`, `Product Description:`, contentResult.productDescription)
    if (gearBlock) descParts.push(`----------`, gearBlock)

    const description = descParts.join('\n')

    return NextResponse.json({
      ok: true,
      asin,
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
      generated: {
        title: titleResult.best,
        description,
        tags: seoData.tags,
        pinnedComment: engagementResult.pinnedComment,
        title_alternatives: titleResult.alternatives,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-metadata swarm]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
