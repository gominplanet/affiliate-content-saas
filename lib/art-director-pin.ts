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
import { badDealCopy, dealFallbackHeadline, DEAL_FALLBACK_SUBHEAD } from '@/lib/deal-pin-copy'
import { scrubBanned } from '@/lib/scrub'

interface Brief { line1: string; line2: string; callouts: string[]; concept: string; palette: string }

/** Thumbnail headline style. 'statement' = the current polished benefit
 *  headline (default). 'question' = a curiosity question about the product
 *  ("DOES IT ACTUALLY WORK?") that earns the click. Threaded through every
 *  thumbnail generator so the user's toggle reaches all of them. */
export type HeadlineStyle = 'statement' | 'question'

// Words/angles the QUESTION headline must never use (Seb's rule): no money /
// price / value framing, no retailer name, no "buy", no "game changer". Applied
// as a hard prompt rule AND a post-check that rejects a violating question.
const BANNED_Q = /\b(money|price|pricing|priced|cost|costs|costly|cheap|cheaper|expensive|amazon|purchase|purchasing|buy|buys|buying|bought|worth\s+(?:it|the)|game[-\s]?changer)\b/i

const BRIEF_SYSTEM = `You are a world-class product-review ART DIRECTOR designing ONE scroll-stopping vertical Pinterest pin for a product. Return STRICT JSON: {"line1","line2","callouts","concept","palette"}.
- line1 / line2: a punchy 2-line ALL-CAPS headline for the product (line1 ≤ 15 chars, line2 ≤ 20 chars). Specific to THIS product's category, standout feature or benefit.
- callouts: 3 short benefit/spec chips (2-4 words each), grounded in the product.
- concept: one sentence describing the layout + vibe.
- palette: the colour direction, tuned to the product.
HARD RULES: never the word "Amazon" or a retailer name/logo. No people. NEVER a year or date (no "2025", "2026", "THIS YEAR") — keep it evergreen so the graphic never looks dated. Do NOT use "HIDDEN GEM", "GAME CHANGER", "MUST-HAVE", "YOU NEED THIS" — be specific and fresh. JSON only, no markdown.`

// Question-hook variant: same designed look, but the headline is a short,
// specific curiosity QUESTION about the product's real claim/effect/experience.
const BRIEF_SYSTEM_QUESTION = `You are a world-class product-review ART DIRECTOR designing ONE scroll-stopping thumbnail for a product, in the CURIOSITY-QUESTION style. The headline is a short, punchy QUESTION that makes someone need to click to find the answer. Return STRICT JSON: {"line1","line2","callouts","concept","palette"}.
- line1 / line2: split ONE question across two ALL-CAPS lines (line1 ≤ 16 chars, line2 ≤ 20 chars). Make it SPECIFIC to THIS product's real claim, effect, taste/feel or result — not generic. Examples of the vibe: a fat-burner → "DOES IT REALLY" / "BURN FAT???"; fish oil → "ANY FISHY" / "AFTERTASTE?"; a testosterone complex → "DOES THIS" / "ACTUALLY WORK???"; a shaver → "IS IT REALLY" / "THAT CLOSE?". End with a question mark ("?" or "???" for punch).
- callouts: 3 short benefit/spec chips (2-4 words each), grounded in the product.
- concept: one sentence describing the layout + vibe.
- palette: the colour direction, tuned to the product.
HARD RULES for the QUESTION: NEVER mention money, price, cost, "cheap", "expensive", value, "worth it", "amazon", "purchase", or "buy"/"buying"/"bought"/"should I buy". NEVER say "game changer". Ask about performance, results, taste/feel, quality, or whether it lives up to the hype — NEVER about price or buying. Never a retailer name/logo, no people described here, NEVER a year or date. JSON only, no markdown.`

async function designPinBrief(productTitle: string, productContext: string, userId?: string | null, tier?: string | null, headlineStyle: HeadlineStyle = 'statement'): Promise<Brief | null> {
  try {
    const isQuestion = headlineStyle === 'question'
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: isQuestion ? BRIEF_SYSTEM_QUESTION : BRIEF_SYSTEM,
      messages: [{ role: 'user', content: `PRODUCT: ${productTitle}\n${productContext ? `DETAILS:\n${productContext.slice(0, 700)}` : ''}\n\nDesign the ${isQuestion ? 'curiosity-question ' : ''}pin brief now.` }],
    })
    if (userId) { const u = usageFromAnthropic(msg); recordUsage({ userId, tier: tier ?? null, feature: 'pinterest_art_director', model: 'claude-sonnet-4-6', input: u.input, output: u.output }) }
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<Brief>
    const clean = (s: unknown, n: number) => stripDesignBrands(scrubBanned(String(s || '').trim())).slice(0, n)
    let line1 = clean(j.line1, 16).toUpperCase()
    let line2 = clean(j.line2, 22).toUpperCase()
    // Question mode: enforce the banned-word rule (no money/price/buy/amazon/
    // "game changer"). If the model slipped one in, fall back to a safe generic
    // curiosity question rather than shipping a banned headline.
    if (isQuestion && BANNED_Q.test(`${line1} ${line2}`)) { line1 = 'DOES IT'; line2 = 'ACTUALLY WORK?' }
    return {
      line1,
      line2,
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
  headlineStyle?: HeadlineStyle
}): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (!opts.productImageUrl || !opts.productTitle) return null

    // Product reference → PNG bytes.
    const ab = await fetch(opts.productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    if (!ab) return null
    const productPng = await normalizeToPng(new Uint8Array(ab)).catch(() => null)
    if (!productPng) return null

    const brief = await designPinBrief(opts.productTitle, opts.productContext || '', opts.userId, opts.tier, opts.headlineStyle)
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
      'NO YEARS OR DATES anywhere in the image (no "2025", "2026") — keep it evergreen so it never looks dated.',
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

/**
 * Generate a designed 16:9 BLOG HERO thumbnail (1280×720) from a product photo +
 * title — the Art Director look, landscape, for a blog post's featured image.
 * Same engine as the pin, just reframed to 16:9 with a thumbnail-style brief.
 * Returns base64 JPEG (data + mediaType) or null on any failure (caller keeps
 * the existing thumbnail). Counts a landscape-thumbnail token when it succeeds.
 */
export async function generateArtDirectorBlogHero(opts: {
  productImageUrl: string
  productTitle: string
  productContext?: string
  userId?: string | null
  tier?: string | null
  headlineStyle?: HeadlineStyle
}): Promise<{ data: string; mediaType: string } | null> {
  try {
    if (!opts.productImageUrl || !opts.productTitle) return null

    const ab = await fetch(opts.productImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    if (!ab) return null
    const productPng = await normalizeToPng(new Uint8Array(ab)).catch(() => null)
    if (!productPng) return null

    // Reuse the pin brief (headline + callouts, grounded in the product).
    const brief = await designPinBrief(opts.productTitle, opts.productContext || '', opts.userId, opts.tier, opts.headlineStyle)
    const line1 = brief?.line1 || stripDesignBrands(opts.productTitle).toUpperCase().slice(0, 16)
    const line2 = brief?.line2 || ''
    const callouts = brief?.callouts?.length ? brief.callouts : []

    const prompt = [
      'FORMAT — READ FIRST: a 16:9 LANDSCAPE blog article hero image (1536×864, wide). A polished, high-contrast product-review header graphic: the product as the hero, a big bold designed headline, small benefit callouts. Vibrant and modern, never flat or template-like. Fill the wide frame with a clean layout.',
      brief?.concept ? `DESIGN CONCEPT: ${brief.concept}` : '',
      brief?.palette ? `COLOUR PALETTE: ${brief.palette}.` : '',
      'PRODUCT (the hero): recreate the product from Image 1 accurately and prominently — its true shape, colours and its own printed branding. Light it naturally with a grounded shadow; no glow ring.',
      'ABSOLUTELY NO PEOPLE — HARD RULE: zero humans, faces, hands, body parts, silhouettes or reflections. If Image 1 shows a model or hands, keep ONLY the product.',
      `MAIN HEADLINE — render EXACTLY, spelling perfect: "${line1} ${line2}". A designed, layered look (mixed colour/size/weight), placed where it does NOT cover the product.`,
      callouts.length ? `CALLOUTS: work these in as small bright checkmark chips or spec pills, correctly spelled: ${callouts.join(' · ')}.` : '',
      'NO YEARS OR DATES anywhere in the image (no "2025", "2026") — keep it evergreen so it never looks dated.',
      NO_BRAND_IMAGE_CLAUSE,
      'FRAMING: the entire canvas is shown — nothing cropped. Keep every headline, badge, callout and the whole product inside a ~5% safe margin on all four sides.',
    ].filter(Boolean).join('\n')

    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({
      prompt,
      images: [{ data: productPng, filename: 'product.png', mime: 'image/png' }],
      size: '1536x864',
      quality: 'medium',
    })
    if (!b64) return null
    if (opts.userId) recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'yt_thumb_graphic', model: 'gpt-image-2', images: 1 })

    const jpeg = await sharp(Buffer.from(b64, 'base64')).resize(1280, 720, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer()
    return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' }
  } catch { return null }
}

const COLLAGE_SYSTEM = `You are a world-class product-review ART DIRECTOR designing ONE scroll-stopping vertical Pinterest pin for a MULTI-PRODUCT buying guide / comparison (a "top picks" roundup). Return STRICT JSON: {"headline","subhead","palette"}.
- headline: a punchy ALL-CAPS roundup headline (≤ 22 chars) — e.g. the category + a "best of" angle. Specific to the category, never generic.
- subhead: a short supporting line (≤ 26 chars), e.g. "COMPARED & RANKED" or a benefit angle. May be empty.
- palette: the colour direction for the whole board.
HARD RULES: never the word "Amazon" or a retailer name/logo. No people. NEVER a year or date. Do NOT use "HIDDEN GEM", "GAME CHANGER", "MUST-HAVE", "YOU NEED THIS". JSON only, no markdown.`

// The deals variant. The buying-guide prompt above asks for "the category + a
// best-of angle", and on a four-deal roundup that produced "COOL YOUR SPACE /
// RANKED & READY TO BUY": a benefit line for one product, plus a ranking claim,
// on a pin whose whole subject is that several separate things dropped in price
// at the same time. Neither half was true of the post.
//
// So a deals pin gets its own brief. The news is the COUNT and the DROP, and
// the headline has to say so on its own, because the headline is baked into the
// image and is often the only thing anyone reads.
const COLLAGE_SYSTEM_DEAL = `You are a world-class ART DIRECTOR designing ONE scroll-stopping vertical Pinterest pin for a DEALS ROUNDUP: several DIFFERENT products that have each dropped in price right now. Return STRICT JSON: {"headline","subhead","palette"}.
- headline: a punchy ALL-CAPS headline (≤ 22 chars) that says this is a roundup of MULTIPLE current deals in this category. Lead with the count. Vibe: "4 KITCHEN PRICE DROPS", "6 HOME DEALS RIGHT NOW", "5 DESK DEALS TODAY". It must NOT read as a headline about one single product, and must NOT describe one product's benefit.
- subhead: a short supporting line (≤ 26 chars) about the prices being down now, e.g. "ALL AT THEIR LOWEST", "PRICES DROPPED TODAY", "LIVE RIGHT NOW". May be empty.
- palette: the colour direction for the whole board — bright retail-sale energy.
HARD RULES: these are simultaneous price drops, NOT a ranking and NOT a review — never "RANKED", "RATED", "BEST", "TOP 5", "OUR PICKS", "#1", or any countdown framing. NEVER invent a discount figure: no percentages, no "% OFF", no currency amounts, because you have not been told what any of them cost. Never the word "Amazon" or a retailer name/logo. No people. NEVER a year or date. Do NOT use "HIDDEN GEM", "GAME CHANGER", "MUST-HAVE", "YOU NEED THIS". JSON only, no markdown.`

async function designCollageBrief(category: string, productTitles: string[], userId?: string | null, tier?: string | null, kind: 'deal' | 'guide' = 'guide'): Promise<{ headline: string; subhead: string; palette: string } | null> {
  try {
    const isDeal = kind === 'deal'
    const n = productTitles.length
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: isDeal ? COLLAGE_SYSTEM_DEAL : COLLAGE_SYSTEM,
      messages: [{ role: 'user', content: `CATEGORY: ${category}\n${isDeal ? `${n} PRODUCTS, EACH CURRENTLY DISCOUNTED` : `PRODUCTS (${n})`}:\n${productTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nDesign the ${isDeal ? 'deals ' : ''}roundup pin brief now.` }],
    })
    if (userId) { const u = usageFromAnthropic(msg); recordUsage({ userId, tier: tier ?? null, feature: 'pinterest_art_director', model: 'claude-sonnet-4-6', input: u.input, output: u.output }) }
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { headline?: string; subhead?: string; palette?: string }
    const clean = (s: unknown, len: number) => stripDesignBrands(scrubBanned(String(s || '').trim())).slice(0, len)
    let headline = clean(j.headline, 24).toUpperCase()
    let subhead = clean(j.subhead, 28).toUpperCase()
    // A prompt rule is a request; this is the check. Text that gets past it is
    // baked into a JPEG and posted, where nobody can edit it after the fact.
    if (isDeal) {
      if (badDealCopy(headline)) headline = dealFallbackHeadline(n, stripDesignBrands(category))
      if (badDealCopy(subhead)) subhead = DEAL_FALLBACK_SUBHEAD
    }
    return { headline, subhead, palette: String(j.palette || '').trim().slice(0, 140) }
  } catch { return null }
}

/**
 * Generate a designed 2:3 roundup pin (1000×1500) that shows 2–4 REAL product
 * photos together in one comparison/grid design (headline + numbered tiles),
 * grounded on the actual product images. Returns base64 JPEG or null on any
 * failure (caller falls back to the name-grounded collage).
 */
export async function generateArtDirectorCollagePin(opts: {
  products: Array<{ imageUrl: string; title: string }>
  category: string
  /** 'deal' = a Deal Radar roundup of price drops; 'guide' = a buying guide.
   *  They are different posts and should not produce the same pin: on a deals
   *  roundup the news is the price, not the verdict, so the design leads with
   *  the saving rather than with "our picks". */
  kind?: 'deal' | 'guide'
  userId?: string | null
  tier?: string | null
}): Promise<{ data: string; mediaType: string } | null> {
  try {
    const items = (opts.products || []).filter((p) => p.imageUrl && p.title).slice(0, 4)
    if (items.length < 2) return null

    // Fetch every product reference → PNG. Skip any that fail; still proceed if
    // ≥ 2 survive so one dead image link can't kill the whole roundup pin.
    const pngs = (await Promise.all(items.map(async (it) => {
      const ab = await fetch(it.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
      if (!ab) return null
      const png = await normalizeToPng(new Uint8Array(ab)).catch(() => null)
      return png ? { data: png, title: it.title } : null
    }))).filter(Boolean) as Array<{ data: Uint8Array; title: string }>
    if (pngs.length < 2) return null

    const n = pngs.length
    const isDeal = opts.kind === 'deal'
    const brief = await designCollageBrief(opts.category, pngs.map((p) => p.title), opts.userId, opts.tier, isDeal ? 'deal' : 'guide')
    // The fallbacks matter as much as the brief: when the copy call fails, this
    // text is what gets printed on the pin. "TOP 4 … / COMPARED & RANKED" on a
    // set of simultaneous price drops is the same wrong claim, just ours.
    const headline = brief?.headline
      || (isDeal ? dealFallbackHeadline(n, stripDesignBrands(opts.category)) : `TOP ${n} ${stripDesignBrands(opts.category).toUpperCase()}`.slice(0, 24))
    const subhead = brief?.subhead || (isDeal ? DEAL_FALLBACK_SUBHEAD : 'COMPARED & RANKED')
    const layout = n >= 4 ? 'a clean 2×2 grid of four tiles' : n === 3 ? 'three tiles (one wider feature tile on top, two below)' : 'two bold side-by-side tiles'

    const prompt = [
      // A deals roundup and a buying guide are different posts and must not
      // produce the same pin. On a deals post the news is the PRICE: what a
      // shopper is scanning for is "several things are cheap right now", not
      // "here are my considered picks". Numbered ranking badges belong on a
      // guide, where the order means something; on a deals grid they imply a
      // ranking that does not exist.
      isDeal
        ? `FORMAT — READ FIRST: a 2:3 VERTICAL PINTEREST PIN (1024×1536, tall portrait) for a ROUNDUP OF ${n} CURRENT PRICE DROPS. Show ALL ${n} products TOGETHER on ONE design as ${layout}, each in its own clearly separated tile. This is a DEALS board, not a review: energetic, retail-sale feel, with a bold headline band across the TOP and a shop-style call-to-action near the BOTTOM (e.g. "SEE ALL DEALS", "TAP TO SHOP"). Bright, high-contrast, urgent without being tacky. No numbered ranking badges — these are simultaneous deals, not a countdown.`
        : `FORMAT — READ FIRST: a 2:3 VERTICAL PINTEREST PIN (1024×1536, tall portrait) for a MULTI-PRODUCT buying guide. Show ALL ${n} products TOGETHER on ONE design as ${layout}, each product in its own clearly separated tile with a small round number badge (1, 2, 3${n >= 4 ? ', 4' : ''}). A bold headline band across the TOP and a shop-style call-to-action near the BOTTOM (e.g. "SEE ALL PICKS"). Vibrant, modern, high-contrast, magazine-roundup feel — never flat or template-like.`,
      // An image model reaches for a sale starburst the moment it is told
      // "deals", and it has no idea what anything costs. A made-up "50% OFF"
      // baked into a published pin is a price claim we cannot stand behind, so
      // it is forbidden in the image as well as in the copy.
      isDeal
        ? 'NO INVENTED NUMBERS: do not draw any discount percentage, price, "% OFF" starburst, currency amount, or ranking word ("BEST", "TOP", "RANKED", "#1") anywhere. The only words in the image are the headline, the sub-line, and the call to action.'
        : '',
      brief?.palette ? `COLOUR PALETTE: ${brief.palette}.` : '',
      `PRODUCTS (the heroes): the ${n} attached images are the ${n} products IN ORDER. Recreate EACH one accurately in its own tile — its true shape, colours and its own printed branding — one product per tile, equally prominent, crisp and centred, on a clean neutral or soft-gradient tile background. Do NOT merge, duplicate, or invent extra products; exactly ${n} distinct products, matching the ${n} references.`,
      'ABSOLUTELY NO PEOPLE — HARD RULE: zero humans, faces, hands, body parts, silhouettes or reflections anywhere. If a reference shows a model or hands, keep ONLY the product.',
      `MAIN HEADLINE — render EXACTLY, spelling perfect: "${headline}"${subhead ? ` with a smaller sub-line "${subhead}"` : ''}. Designed and layered, placed in the top band where it does NOT cover any product.`,
      NO_BRAND_IMAGE_CLAUSE,
      'FRAMING: the entire canvas is shown — nothing cropped. Keep every tile, number badge, headline and product fully inside a ~5% safe margin on all four sides.',
    ].filter(Boolean).join('\n')

    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({
      prompt,
      images: pngs.map((p, i) => ({ data: p.data, filename: `product-${i + 1}.png`, mime: 'image/png' })),
      size: '1024x1536',
      quality: 'medium',
    })
    if (!b64) return null
    if (opts.userId) recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'pinterest_art_director', model: 'gpt-image-2', images: 1 })

    const jpeg = await sharp(Buffer.from(b64, 'base64')).resize(1000, 1500, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer()
    return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' }
  } catch { return null }
}
