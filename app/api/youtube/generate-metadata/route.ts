import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAmazonProduct } from '@/services/amazon'
import { createGeniuslinkService } from '@/services/geniuslink'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

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
      .select('name,author_name,niches,tone,affiliate_disclaimer,website_url,contact_email')
      .eq('user_id', user.id)
      .single()

    // ── 2. Fetch Geniuslink credentials ────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .single()

    // ── 3. Get Amazon product data ─────────────────────────────────────────────
    let product
    try {
      product = await fetchAmazonProduct(asin)
    } catch {
      // Fall back to generating without product data
      product = { asin, title: videoTitle, bullets: [], description: '', price: null, rating: null, imageUrl: null }
    }

    // ── 4. Create Geniuslink affiliate URL ─────────────────────────────────────
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
    } else {
      geniuslinkError = 'Geniuslink credentials not configured in Site & Integrations'
    }

    // ── 5. Generate YouTube metadata with Claude ───────────────────────────────
    const b = brand as Record<string, unknown> | null
    const brandName = (b?.name as string) || 'our channel'
    const authorName = (b?.author_name as string) || ''
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const tone = ((b?.tone as string[]) || []).join(', ') || 'conversational, friendly'
    const websiteUrl = (b?.website_url as string) || ''
    const contactEmail = (b?.contact_email as string) || ''
    const collabLine = websiteUrl
      ? `Want Your Product Reviewed? Check OUR WEBSITE for collaborations: ${websiteUrl}`
      : contactEmail
        ? `Want Your Product Reviewed? Reach out: ${contactEmail}`
        : ''

    const productContext = [
      product.title ? `Product: ${product.title}` : '',
      product.price ? `Price: ${product.price}` : '',
      product.rating ? `Rating: ${product.rating}/5` : '',
      product.bullets.length ? `Features:\n${product.bullets.map(b => `- ${b}`).join('\n')}` : '',
      product.description ? `Description: ${product.description}` : '',
    ].filter(Boolean).join('\n')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are writing YouTube metadata for ${brandName}${authorName ? ` (${authorName})` : ''}.
Brand niche: ${niches}
Brand tone: ${tone}

Amazon product (ASIN: ${asin}):
${productContext}

Original video title: "${videoTitle}"
${videoDescription ? `Original description snippet: "${videoDescription.slice(0, 300)}"` : ''}

Generate optimised YouTube metadata. Return ONLY valid JSON with these exact keys:

{
  "title": "Compelling YouTube title under 100 chars — include product name, key benefit, and a hook. Do NOT include the ASIN.",
  "description": "Use EXACTLY this structure (preserve the blank lines and formatting):\n\nCheck Today's Price and Availability on AMAZON here: ${affiliateUrl}\n\nAs Amazon Influencers, we earn commissions—at no cost to you—from qualifying purchases.\n\n[Generate 12-15 highly relevant hashtags starting with # separated by spaces — mix product-specific, niche, and broad tags]\n\nIf this helped, subscribe for more real reviews and drop your biggest question below—we reply to comments.\n${collabLine ? `\n${collabLine}\n` : '\n'}\n[Write 3-5 sentences about the product: what it does, key benefits, who it's for, the biggest benefit, and ideal use cases. Write in ${tone} tone. Do NOT use bullet points here — flowing sentences only.]\n\nQuick Verdict: [One punchy sentence summarising who should buy this and why.]",
  "tags": ["array", "of", "20-30", "relevant", "tags", "no # symbol", "mix of broad and specific"],
  "pinnedComment": "A short punchy comment to pin (2-3 sentences). Include the affiliate link (${affiliateUrl}) and a call to action.",
  "title_alternatives": ["3 alternative title options"]
}`,
      }],
    })

    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude returned invalid JSON')
    const generated = JSON.parse(jsonMatch[0]) as {
      title: string
      description: string
      tags: string[]
      pinnedComment: string
      title_alternatives: string[]
    }

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
      generated,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
