import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct } from '@/services/amazon'
import { createGeniuslinkService } from '@/services/geniuslink'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

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

    // ── 1. Fetch brand profile ─────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('name,author_name,niches,tone,website_url,contact_email,gear_sections')
      .eq('user_id', user.id)
      .single()

    // ── 2. Fetch credentials ───────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
      .eq('user_id', user.id)
      .single()

    // ── 3. Get Amazon product data ─────────────────────────────────────────────
    let product
    try {
      product = await fetchAmazonProduct(asin)
    } catch {
      product = { asin, title: videoTitle, bullets: [], description: '', price: null, rating: null, imageUrl: null }
    }

    // ── 4. Build affiliate URL (Geniuslink → Associates tag → plain) ──────────
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
        console.error('Geniuslink error:', geniuslinkError)
      }
    }

    if (!geniuslinkUsed && intRow?.amazon_associates_tag) {
      affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${intRow.amazon_associates_tag}`
      geniuslinkError = null
    } else if (!geniuslinkUsed && !intRow?.amazon_associates_tag) {
      geniuslinkError = geniuslinkError || 'No affiliate link configured — add Geniuslink or Amazon Associates tag in Site & Integrations'
    }

    // ── 5. Build brand context ────────────────────────────────────────────────
    const b = brand as Record<string, unknown> | null
    const brandName = (b?.name as string) || 'our channel'
    const authorName = (b?.author_name as string) || ''
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const tone = ((b?.tone as string[]) || []).join(', ') || 'conversational, friendly'
    const websiteUrl = (b?.website_url as string) || ''
    const contactEmail = (b?.contact_email as string) || ''
    const gearSections = ((b?.gear_sections as GearSection[]) || []).filter(s => s.title && s.items.length > 0)

    // Collaboration line
    const collabLine = websiteUrl
      ? `Let's Work Together! Check my WEBSITE for collaborations: ${websiteUrl}`
      : contactEmail
        ? `Let's Work Together! Email me for collaborations: ${contactEmail}`
        : ''

    // Gear sections block
    const gearBlock = gearSections.map(section => {
      const itemLines = section.items
        .filter(i => i.name && i.url)
        .map(i => `${i.name}: ${i.url}`)
        .join('\n')
      return `${section.title}: (Amazon affiliate links)\n${itemLines}`
    }).join('\n\n')

    const productContext = [
      product.title ? `Product: ${product.title}` : '',
      product.price ? `Price: ${product.price}` : '',
      product.rating ? `Rating: ${product.rating}/5` : '',
      product.bullets.length ? `Features:\n${product.bullets.map((b: string) => `- ${b}`).join('\n')}` : '',
      product.description ? `Description: ${product.description}` : '',
    ].filter(Boolean).join('\n')

    // ── 6. Generate with Claude ───────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: `You are an expert YouTube SEO strategist and viral content creator for ${brandName}${authorName ? ` (${authorName})` : ''}.

BRAND INFO:
- Niche: ${niches}
- Tone: ${tone}

PRODUCT DATA (ASIN: ${asin}):
${productContext}

ORIGINAL VIDEO TITLE: "${videoTitle}"
${videoDescription ? `ORIGINAL DESCRIPTION SNIPPET: "${videoDescription.slice(0, 300)}"` : ''}

YOUR MISSION: Generate maximum-reach YouTube metadata that dominates search on YouTube, Google, and AI answer engines (ChatGPT, Gemini, Perplexity). Think like a viral content strategist:

TITLE STRATEGY:
- Lead with the strongest hook word (Review, Honest Review, Worth It?, Before You Buy, Best, Worst, etc.)
- Include the exact product name people search for
- Add a compelling benefit or emotional trigger
- Under 100 characters
- DO NOT include the ASIN

HASHTAG STRATEGY:
- Think: what are people actually typing into YouTube search for this product?
- Mix: brand-specific + product type + use case + trending broad tags
- Include #ad #affiliate #productreview + 15-18 niche-specific ones
- Total: 18-22 hashtags

PRODUCT DESCRIPTION STRATEGY:
- Write 3-4 sentences optimised for AI answer engines
- Answer: What is it? Who is it for? What's the #1 benefit? Is it worth buying?
- Use natural language with keywords people search for
- Tone: ${tone}

Return ONLY valid JSON:
{
  "title": "Viral SEO-optimised title under 100 chars",
  "hashtags": "#tag1 #tag2 #tag3 ... (space-separated, 18-22 tags)",
  "productDescription": "3-4 sentences optimised for YouTube, Google and AI search engines.",
  "pinnedComment": "Punchy pinned comment 2-3 sentences. Include ${affiliateUrl} and a CTA.",
  "title_alternatives": ["3 alternative viral title options"],
  "tags": ["20-30 tags without # symbol — mix of exact-match search terms, broad keywords, and long-tail phrases people search on YouTube"]
}`,
      }],
    })

    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned invalid JSON')
    const claude = JSON.parse(jsonMatch[0]) as {
      title: string
      hashtags: string
      productDescription: string
      pinnedComment: string
      title_alternatives: string[]
      tags: string[]
    }

    // ── 7. Assemble final description from template ───────────────────────────
    const descParts = [
      `Check Today's Price and Availability on AMAZON here: ${affiliateUrl}`,
      `(affiliate link)`,
      `----------`,
      `Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.`,
      claude.hashtags,
      `----------`,
      `Thank you for watching! If you enjoyed this video review and found it useful, please subscribe and like for more product reviews :)`,
    ]

    if (collabLine) {
      descParts.push(`----------`, collabLine)
    }

    descParts.push(
      `----------`,
      `Product ASIN: ${asin}`,
      `----------`,
      `Product Description:`,
      claude.productDescription,
    )

    if (gearBlock) {
      descParts.push(`----------`, gearBlock)
    }

    const description = descParts.join('\n')

    return NextResponse.json({
      ok: true,
      asin,
      affiliateUrl,
      geniuslinkUsed,
      geniuslinkError,
      product: {
        title: product.title,
        price: product.price,
        rating: product.rating,
        imageUrl: product.imageUrl,
      },
      generated: {
        title: claude.title,
        description,
        tags: claude.tags,
        pinnedComment: claude.pinnedComment,
        title_alternatives: claude.title_alternatives,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
