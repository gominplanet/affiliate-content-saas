// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP Art Director pin for the blog "Social Push" flow. Produces the same kind
// of designed, text-baked 2:3 pin the Amazon Influencer composer makes (product
// hero + bold headline + callouts), instead of the older scene + Satori-overlay
// pin. Self-contained and best-effort: ANY failure returns null so the caller
// falls straight back to its existing generator — this can never break the flow.
import sharp from 'sharp'
import { createOpenAIService, normalizeToPng } from '@/services/openai'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { NO_BRAND_IMAGE_CLAUSE, stripDesignBrands } from '@/lib/image-guard'
import { scrubBanned } from '@/lib/scrub'

interface Brief { line1: string; line2: string; callouts: string[]; concept: string; palette: string }

const BRIEF_SYSTEM = `You are a world-class product-review ART DIRECTOR designing ONE scroll-stopping vertical Pinterest pin for a product. Return STRICT JSON: {"line1","line2","callouts","concept","palette"}.
- line1 / line2: a punchy 2-line ALL-CAPS headline for the product (line1 ≤ 15 chars, line2 ≤ 20 chars). Specific to THIS product's category, standout feature or benefit.
- callouts: 3 short benefit/spec chips (2-4 words each), grounded in the product.
- concept: one sentence describing the layout + vibe.
- palette: the colour direction, tuned to the product.
HARD RULES: never the word "Amazon" or a retailer name/logo. No people. Do NOT use "HIDDEN GEM", "GAME CHANGER", "MUST-HAVE", "YOU NEED THIS" — be specific and fresh. JSON only, no markdown.`

async function designPinBrief(productTitle: string, productContext: string, userId?: string | null, tier?: string | null): Promise<Brief | null> {
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: BRIEF_SYSTEM,
      messages: [{ role: 'user', content: `PRODUCT: ${productTitle}\n${productContext ? `DETAILS:\n${productContext.slice(0, 700)}` : ''}\n\nDesign the pin brief now.` }],
    })
    if (userId) { const u = usageFromAnthropic(msg); recordUsage({ userId, tier: tier ?? null, feature: 'pinterest_art_director', model: 'claude-sonnet-4-6', input: u.input, output: u.output }) }
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<Brief>
    const clean = (s: unknown, n: number) => stripDesignBrands(scrubBanned(String(s || '').trim())).slice(0, n)
    return {
      line1: clean(j.line1, 16).toUpperCase(),
      line2: clean(j.line2, 22).toUpperCase(),
      callouts: Array.isArray(j.callouts) ? j.callouts.map((c) => clean(c, 24)).filter(Boolean).slice(0, 3) : [],
      concept: String(j.concept || '').trim().slice(0, 400),
      palette: String(j.palette || '').trim().slice(0, 140),
    }
  } catch { return null }
}

/**
 * Generate a designed 2:3 pin (1000×1500) from a product photo + title. Returns
 * base64 JPEG (data + mediaType) or null on any failure.
 */
export async function generateArtDirectorPin(opts: {
  productImageUrl: string
  productTitle: string
  productContext?: string
  userId?: string | null
  tier?: string | null
}): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (!opts.productImageUrl || !opts.productTitle) return null

    // Product reference → PNG bytes.
    const ab = await fetch(opts.productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    if (!ab) return null
    const productPng = await normalizeToPng(new Uint8Array(ab)).catch(() => null)
    if (!productPng) return null

    const brief = await designPinBrief(opts.productTitle, opts.productContext || '', opts.userId, opts.tier)
    const line1 = brief?.line1 || stripDesignBrands(opts.productTitle).toUpperCase().slice(0, 16)
    const line2 = brief?.line2 || ''
    const callouts = brief?.callouts?.length ? brief.callouts : []

    const prompt = [
      'FORMAT — READ FIRST: a 2:3 VERTICAL PINTEREST PIN (1024×1536, tall portrait). A shopping pin whose only job is to earn the click to buy: a big bold headline across the TOP, a STACKED vertical list of benefit/feature callouts (checkmarks or chips) down the middle, and a strong shop-style call-to-action near the BOTTOM (e.g. "TAP TO SHOP"). Vibrant, modern, high-contrast, layered — never flat or template-like. Fill the tall frame top-to-bottom.',
      brief?.concept ? `DESIGN CONCEPT: ${brief.concept}` : '',
      brief?.palette ? `COLOUR PALETTE: ${brief.palette}.` : '',
      `PRODUCT (the hero): recreate the product from Image 1 accurately and prominently — its true shape, colours and its own printed branding. Light it naturally with a grounded shadow; no glow ring.`,
      'ABSOLUTELY NO PEOPLE — HARD RULE: zero humans, faces, hands, body parts, silhouettes or reflections. If Image 1 shows a model or hands, keep ONLY the product.',
      `MAIN HEADLINE — render EXACTLY, spelling perfect: "${line1} ${line2}". A designed, layered look (mixed colour/size/weight), placed where it does NOT cover the product.`,
      callouts.length ? `CALLOUTS: work these in as small bright checkmark chips or spec pills, correctly spelled: ${callouts.join(' · ')}.` : '',
      NO_BRAND_IMAGE_CLAUSE,
      'FRAMING: the entire canvas is shown — nothing cropped. Keep every headline, badge, callout and the whole product inside a ~5% safe margin on all four sides.',
    ].filter(Boolean).join('\n')

    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({
      prompt,
      images: [{ data: productPng, filename: 'product.png', mime: 'image/png' }],
      size: '1024x1536',
      quality: 'medium',
    })
    if (!b64) return null
    if (opts.userId) recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'pinterest_art_director', model: 'gpt-image-2', images: 1 })

    const jpeg = await sharp(Buffer.from(b64, 'base64')).resize(1000, 1500, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer()
    return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' }
  } catch { return null }
}
