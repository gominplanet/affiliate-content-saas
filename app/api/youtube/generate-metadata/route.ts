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
      .select('name,author_name,niches,tone,affiliate_disclaimer')
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
    if (intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        affiliateUrl = await genius.createAsinLink(asin, product.title || videoTitle)
      } catch { /* use plain Amazon URL as fallback */ }
    }

    // ── 5. Generate YouTube metadata with Claude ───────────────────────────────
    const b = brand as Record<string, unknown> | null
    const brandName = (b?.name as string) || 'our channel'
    const authorName = (b?.author_name as string) || ''
    const niches = ((b?.niches as string[]) || []).join(', ') || 'consumer products'
    const tone = ((b?.tone as string[]) || []).join(', ') || 'conversational, friendly'
    const disclaimer = (b?.affiliate_disclaimer as string) || 'This video contains affiliate links.'

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
  "description": "Full YouTube description (500-800 words). Structure: 1) Hook paragraph with what they'll learn, 2) Product overview, 3) Key features breakdown (use the bullet points), 4) Who it's for, 5) Final verdict. Include the affiliate link (${affiliateUrl}) naturally 2-3 times. End with the disclaimer. Write in ${tone} tone.",
  "tags": ["array", "of", "20-30", "relevant", "tags", "mix of", "broad and", "specific"],
  "pinnedComment": "A short punchy comment to pin (2-3 sentences). Include the affiliate link and a call to action.",
  "title_alternatives": ["3 alternative title options"]
}

Disclaimer to include at end of description:
"${disclaimer}"`,
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
