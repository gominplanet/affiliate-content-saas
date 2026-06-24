// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Shared Pinterest pin generation — used by /api/blog/pinterest-preview
 * (the editable preview modal, opened from both Library & Social Push
 * and the CC & EPC Campaign pills).
 *
 * Single source of truth so the prompt, banned-word scrubbing, image
 * compositing and compliance text stay consistent everywhere.
 */
import { GoogleGenAI } from '@google/genai'
import { createAnthropicClient } from '@/lib/anthropic'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { composePin, PIN_OVERLAY_THEME_COUNT, PIN_LAYOUT_COUNT } from '@/lib/pin-compose'
import { learnProfileToPrompt } from '@/lib/learn'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { pickProductReferenceImage, verifyProductMatch } from '@/lib/product-image'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { asinFromAmazonUrl } from '@/lib/product-link'

export const AFFILIATE_DISCLAIMER = '📌 Disclosure: As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links — I may earn a small commission at no extra cost to you.'
export const COMPLIANCE_TAGS = '#ad #affiliate'

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY ?? '' })

export interface PinAssets {
  title: string
  description: string
  hashtags: string[]
  disclaimer: string
  complianceTags: string
  link: string
  imageBase64: string | null
  mediaType: string | null
  fallbackImageUrl: string | null
}

/** Compose the exact description that gets published (preview modal and
 *  one-click use this identically): body → hashtags → disclaimer → tags. */
export function composePinDescription(a: PinAssets): string {
  const tagLine = a.hashtags.length ? a.hashtags.map(t => `#${t}`).join(' ') : ''
  return [a.description, tagLine, a.disclaimer, a.complianceTags].filter(Boolean).join('\n\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildPinAssets(p: any, ctx: { userId?: string | null; tier?: string | null }): Promise<PinAssets> {
  // Apply the user's LEARN voice profile to the pin copy too (whatever
  // parts they filled in). Best-effort — a fetch failure must not block
  // pin generation.
  let learnBlock = ''
  if (ctx.userId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bp } = await (createAdminClient() as any)
        .from('brand_profiles').select('learn_profile').eq('user_id', ctx.userId).single()
      learnBlock = learnProfileToPrompt(bp?.learn_profile)
    } catch { /* no voice profile — generate without it */ }
  }

  const anthropic = createAnthropicClient()
  const claudeMsg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert affiliate marketing content strategist. Analyze this blog post and return a JSON object.

${BANNED_RULE}
${learnBlock}

Blog post title: ${p.title}
Blog post content (first 500 chars): ${p.excerpt || p.content?.substring(0, 500) || ''}
Blog URL: ${p.wordpress_url}

Return ONLY valid JSON with these exact keys:

{
  "pin_title": "A curiosity-driven, intrigue-building Pinterest pin title. Max 90 characters. Make people NEED to click — open a loop, hint at a surprising result or mistake — but no false claims and no clickbait lies. Do not just restate the blog title.",
  "pinterest_description": "ONE or TWO short, plain sentences (max ~180 chars total) that simply explain what the post is about, ending with a soft CTA like 'See the full breakdown.' No hashtags, no hype, no keyword stuffing.",
  "hashtags": ["6 to 8 short, relevant, SEO + viral hashtags about THIS post's subject. No '#' symbol, lowercase, no spaces, no banned words. e.g. swampcooler, garagecooling, homecoolinghacks"],
  "product_category": "e.g. Face Cream, Vacuum Cleaner, Dog Toy",
  "product_name": "The specific product name from the post",
  "emotion": "One word emotion for the expert in the image: shocked | excited | relieved | disgusted | happy | amazed",
  "viral_hook": "Short all-caps hook for the image, max 4 words. VARY the angle — rotate among curiosity ('YOU NEED THIS'), warning ('DON'T BUY YET'), result ('GAME CHANGER'), question ('WORTH IT?'). Do NOT reuse a template you'd use for every product.",
  "main_benefit": "Bold benefit text, max 5 words e.g. THE ULTIMATE HACK or IT ACTUALLY WORKS. Make it specific to THIS product, not generic.",
  "trust_factor": "Tiny badge text, 1-3 words. ROTATE the angle every time — do NOT always start with the same word (especially avoid the 'TESTED AND ___' pattern). Mix: a rating (TOP RATED, 4.8★), social proof (CREATOR PICK, 10K+ SOLD), a rank (#1 PICK, BEST OF 2026), or a verdict (WORTH IT, TRIED & TRUE).",
  "problem": "What the product solves, 3-5 words e.g. Dull aging skin or Dirty car interior",
  "solution": "What it delivers, 3-5 words e.g. Glowing youthful skin or Spotless in minutes",
  "collage_products": ["If this post is a multi-product BUYING GUIDE / COMPARISON / roundup, list the 2-4 MOST IMPORTANT specific product names featured (short, recognizable names, most important first). If it's a single-product review, return an empty array []."]
}`,
    }],
  })
  {
    const u = usageFromAnthropic(claudeMsg)
    recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'pinterest_text', model: 'claude-haiku-4-5-20251001', input: u.input, output: u.output })
  }

  const raw = (claudeMsg.content[0] as { type: string; text: string }).text.trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? raw)
  } catch {
    parsed = {
      pin_title: p.title,
      pinterest_description: `${p.title}. See the full breakdown at the link.`,
      hashtags: [],
      product_category: 'Product', product_name: p.title, emotion: 'excited',
      viral_hook: 'MUST SEE THIS', main_benefit: 'TOP RATED PICK',
      trust_factor: 'EDITOR\'S CHOICE', problem: 'Wasting money on bad products',
      solution: 'The best option found',
    }
  }

  const rawTags: string[] = Array.isArray(parsed.hashtags) ? parsed.hashtags : []
  const fields: Record<string, string> = {
    product_category: parsed.product_category, product_name: parsed.product_name,
    emotion: parsed.emotion, viral_hook: parsed.viral_hook, main_benefit: parsed.main_benefit,
    trust_factor: parsed.trust_factor, problem: parsed.problem, solution: parsed.solution,
  }
  for (const k of Object.keys(fields)) fields[k] = scrubBanned(fields[k])
  const hashtags = rawTags
    .map(t => scrubBanned(String(t)).replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean).slice(0, 8)
  // Never fall back to a raw (unscrubbed) value — keep the banned word out
  // even when the scrubbed string is empty.
  const pinTitle = scrubBanned(parsed.pin_title) || scrubBanned(p.title)
  const pinDescription = scrubBanned(parsed.pinterest_description)
    || `${scrubBanned(p.title)}. See the full breakdown at the link.`

  // Multi-product guide/comparison posts get a PRODUCT-COLLAGE pin (a distinct
  // design in the rotation); single-product reviews use the scene rotation.
  const isRoundup = ['guide', 'comparison'].includes(String(p.post_type || '').toLowerCase())
  const collageProducts = (Array.isArray(parsed.collage_products) ? parsed.collage_products : [])
    .map((s: unknown) => scrubBanned(String(s)).trim()).filter(Boolean).slice(0, 4)
  const useCollage = isRoundup && collageProducts.length >= 2

  // Ground the pin's IMAGE on the REAL product — not a name-guess. The blog
  // post links to a product via its source video, whose row stores the clean,
  // vision-picked product photo used in the article. Use that as the generation
  // reference so the rendered product matches reality (the #1 cause of "wrong
  // product" pins was pure text-to-image off a guessed name). Fallbacks:
  // scrape the product link → the article's own hero image. Single-product
  // scenes only; the multi-product collage stays name-grounded.
  let referenceImageUrl: string | null = null
  if (ctx.userId && p.video_id && !useCollage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vid } = await (createAdminClient() as any)
        .from('youtube_videos')
        .select('product_image_url, product_url')
        .eq('id', p.video_id)
        .maybeSingle()
      referenceImageUrl = (vid?.product_image_url as string | null)?.trim() || null
      if (!referenceImageUrl && vid?.product_url) {
        const url = String(vid.product_url)
        // Try the raw link first; if it's a Geniuslink/short link (geni.us,
        // amzn.to, a.co…) the ASIN isn't in the URL, so follow it to its true
        // Amazon destination and read the ASIN there. resolveTrueDestination
        // uses MVP's bot UA — this is link RESOLUTION, never a counted click.
        let asin = asinFromAmazonUrl(url) || extractAsin(url.toUpperCase())
        if (!asin) {
          try {
            const finalUrl = await resolveTrueDestination(url)
            asin = asinFromAmazonUrl(finalUrl) || extractAsin(finalUrl.toUpperCase())
          } catch { /* couldn't unwrap — leave asin null */ }
        }
        if (asin) {
          try {
            const prod = await fetchAmazonProduct(asin)
            const picked = await pickProductReferenceImage(prod.images, prod.title, { userId: ctx.userId })
            referenceImageUrl = (typeof picked === 'string' ? picked : null) || prod.imageUrl || null
          } catch { /* scrape failed — fall through */ }
        }
      }
    } catch { /* no video row — fall through */ }
  }
  // IMPORTANT: do NOT fall back to the article's own featured/thumbnail image as
  // the grounding reference. For MVP those are AI-GENERATED hero scenes (not a
  // real product photo) — grounding on a hallucinated scene reproduces its wrong
  // shape, and the vision QC then compares the new render against that SAME
  // wrong reference and rubber-stamps it. A genuine product photo or nothing:
  // with no real reference we render text-to-image and skip QC (below), which is
  // honest rather than falsely "verified". (The hero still serves as the plain
  // fallbackImageUrl returned to the client.)

  // Roll a fresh overlay style (and, for non-collage, a scene composition) each
  // generation so pins vary — and re-roll on regenerate.
  const styleVariant = Math.floor(Math.random() * PIN_OVERLAY_THEME_COUNT)
  const layoutVariant = Math.floor(Math.random() * PIN_LAYOUT_COUNT)
  const imagePrompt = useCollage
    ? buildCollageImagePrompt(fields.product_category, collageProducts)
    : buildViralImagePrompt(fields, Math.floor(Math.random() * PIN_COMPOSITIONS.length), !!referenceImageUrl)
  let rawImage = await generatePinImage(imagePrompt, useCollage ? null : referenceImageUrl)
  if (rawImage) recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'pinterest_image', model: 'gemini-2.5-flash-image', images: 1 })

  // Vision QC (Claude): confirm we rendered the RIGHT product. Single-product
  // scenes with a real reference only. On a confident mismatch, regenerate ONCE
  // and keep the retry — better a fresh attempt than a published wrong product.
  if (rawImage && !useCollage && referenceImageUrl) {
    const verdict = await verifyProductMatch(referenceImageUrl, { base64: rawImage.data, mediaType: rawImage.mediaType }, fields.product_name, { userId: ctx.userId, tier: ctx.tier })
    if (!verdict.match) {
      const retry = await generatePinImage(imagePrompt, referenceImageUrl)
      if (retry) {
        recordUsage({ userId: ctx.userId, tier: ctx.tier, feature: 'pinterest_image', model: 'gemini-2.5-flash-image', images: 1 })
        rawImage = retry
      }
    }
  }
  const imageResult = rawImage
    ? await composePin(rawImage.data, rawImage.mediaType, {
        viral_hook: fields.viral_hook,
        // Collage: drop the center band (it'd cover the grid) and badge the count.
        main_benefit: useCollage ? '' : fields.main_benefit,
        trust_factor: useCollage ? `TOP ${collageProducts.length} PICKS` : fields.trust_factor,
      }, { styleSeed: styleVariant, layoutSeed: layoutVariant, layout: useCollage ? 'collage' : 'standard' })
    : null
  // (usage already recorded per generation above, incl. the QC retry)

  const fallbackImageUrl = p.featured_image_url || p.thumbnail_url
    || (p.video_id ? `https://i.ytimg.com/vi/${p.video_id}/hqdefault.jpg` : null)

  return {
    title: capSocialText(pinTitle, 100),
    description: capSocialText(pinDescription, SOCIAL_LIMITS.pinterest),
    hashtags,
    disclaimer: AFFILIATE_DISCLAIMER,
    complianceTags: COMPLIANCE_TAGS,
    link: (p.wordpress_url as string | null) || '',
    imageBase64: imageResult?.data ?? null,
    mediaType: imageResult?.mediaType ?? null,
    fallbackImageUrl,
  }
}

// A handful of distinct composition styles so pins don't all look like the same
// before/after split. One is picked at random per generation (and re-rolled on
// regenerate), which is the biggest lever on visual variety.
const PIN_COMPOSITIONS: Array<(f: Record<string, string>) => string> = [
  // 0 — before/after split (the original look)
  f => `A dynamic split-screen before-and-after layout. A charismatic, expressive person (the expert) looks toward camera with a ${f.emotion} expression, gesturing toward the product. Show a clear before-vs-after transformation — before: ${f.problem}; after: ${f.solution} — with ${f.product_name} in real use.`,
  // 1 — single bold hero reaction
  f => `A single bold hero shot: a charismatic person holding ${f.product_name} up toward the camera with a strong ${f.emotion} expression, the product clearly the star, in a clean modern lifestyle setting that fits a ${f.product_category}.`,
  // 2 — authentic lifestyle / in-context
  f => `An authentic lifestyle scene: ${f.product_name} in its natural real-world environment, used as intended for a ${f.product_category}, with a person interacting naturally (slightly off-centre) in a ${f.emotion} mood. Editorial, candid, unposed feel.`,
  // 3 — dramatic product close-up
  f => `A dramatic, crisp close-up of ${f.product_name} filling most of the frame with shallow depth of field; a person softly out of focus in the background reacting with a ${f.emotion} expression. Premium product-photography feel.`,
  // 4 — hands-on / point-of-view
  f => `A hands-on point-of-view scene: human hands actively using ${f.product_name} for a ${f.product_category}, shot slightly top-down, conveying the "${f.solution}" result. Tactile, satisfying, real.`,
  // 5 — flat-lay / styled arrangement
  f => `A clean, styled flat-lay from directly overhead: ${f.product_name} arranged with a few complementary props that suit a ${f.product_category}, on a tasteful surface, bright and aspirational. No people.`,
]

// Multi-product roundup pins (buying guides / comparisons): a clean collage of
// the actual products named in the post. Grounded by name (real photos aren't
// stored), rendered text-free so the headline overlay sits on top.
function buildCollageImagePrompt(category: string, products: string[]): string {
  const list = products.slice(0, 4).join(', ')
  const n = Math.min(products.length, 4)
  const layout = n >= 4 ? 'a balanced 2×2 grid' : n === 3 ? 'three tiles (one larger top, two below)' : 'two side-by-side tiles'
  return `Create a clean, premium PRODUCT-COLLAGE image for a "${category}" buying guide, 2:3 portrait aspect ratio.

Composition: ${layout} showing these ${n} DISTINCT products together, each in its own tile, equally prominent and clearly separated by thin gutters: ${list}. Bright, even e-commerce/studio lighting; each product crisp, centred in its tile, and easily recognizable on a simple light neutral or soft-gradient background. Balanced, catalog-quality arrangement.

Leave a calmer band across the TOP and a little space at the BOTTOM (softer background / gradient) for headline text added later.

ABSOLUTELY NO TEXT: Do NOT render ANY text, letters, words, numbers, captions, labels, logos, watermarks, signage, UI, badges, stickers, price tags, or typography of ANY kind anywhere. Purely photographic product tiles with zero written characters. (Headline text is added separately afterward.)
NO BRANDS: Do NOT render or invent any retailer/marketplace names or logos (especially "Amazon", "Prime", "Walmart", "eBay"), store logos, watermarks, or copyright/trademark symbols — only each product's own physical form/branding.

Final quality: high resolution, photorealistic, professional advertising/product photography, clean and aspirational. Vertical 2:3 portrait. Completely text-free.`
}

function buildViralImagePrompt(f: Record<string, string>, variant = 0, hasReference = false): string {
  const composition = PIN_COMPOSITIONS[variant % PIN_COMPOSITIONS.length](f)
  // When a real product photo is attached, the rendered product MUST match it —
  // this is what stops the model inventing a different/wrong product.
  const referenceClause = hasReference
    ? `\nREFERENCE PRODUCT (CRITICAL): The attached image shows the EXACT product to feature. Render THAT product faithfully — its real SILHOUETTE/outline, shape, proportions, colour, materials and design must match the reference exactly. Do NOT substitute, restyle, reshape, or invent a different product. Do NOT add unrelated extra objects, accessories, props, or duplicate copies of the product that aren't in the reference — keep the real product the single clear hero. If the reference is retail packaging, a box, or a marketing infographic, depict the REAL unpackaged product and ignore any text/logos/badges printed on it. Use the reference ONLY to learn what the product physically looks like — compose a fresh, simple scene around it.\n`
    : ''
  return `Create a high-energy vertical photographic scene for a ${f.product_category}, 2:3 portrait aspect ratio.

Composition: ${composition}
${referenceClause}

Visual Style: Vibrant, saturated colors, high-contrast cinematic lighting, modern lifestyle / luxury-tech aesthetic, shallow depth of field so the subject pops. Leave some clean, less-busy space near the TOP and the BOTTOM of the frame (calmer areas, e.g. softer background or gradient) suitable for overlaying text later.

ABSOLUTELY NO TEXT: Do NOT render ANY text, letters, words, numbers, captions, labels, logos, watermarks, signage, UI, badges, stickers, or typography of ANY kind anywhere in the image. It must be a purely photographic scene with zero written characters. (Headline text is added separately afterward.)
NO BRANDS: Do NOT render or invent any retailer/marketplace names or logos (especially "Amazon", "Prime", "Walmart", "eBay"), any company/store logos, watermarks, copyright/trademark symbols, or price tags anywhere — only the product's own physical branding is allowed.

Final quality: high resolution, photorealistic, professional advertising photography, cinematic post-processing. Vertical 2:3 portrait. Completely text-free.`
}

async function generatePinImage(prompt: string, referenceImageUrl?: string | null): Promise<{ data: string; mediaType: string } | null> {
  // Fetch the real product photo (best-effort) so we can pass it as a visual
  // reference — the model renders the ACTUAL product instead of guessing.
  let inlineRef: { mimeType: string; data: string } | null = null
  if (referenceImageUrl && /^https?:\/\//i.test(referenceImageUrl)) {
    try {
      const res = await fetch(referenceImageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        // Skip absurdly large refs; Gemini inline limit is generous but be safe.
        if (buf.byteLength > 0 && buf.byteLength < 12 * 1024 * 1024) {
          inlineRef = { mimeType: (res.headers.get('content-type') || 'image/jpeg').split(';')[0], data: buf.toString('base64') }
        }
      }
    } catch { /* reference fetch failed — fall back to text-only generation */ }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any = inlineRef
    ? [{ role: 'user', parts: [{ inlineData: inlineRef }, { text: prompt }] }]
    : prompt

  let delay = 8000
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await genai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents,
        config: { responseModalities: ['IMAGE'] },
      })
      const parts = response.candidates?.[0]?.content?.parts
      if (!parts) return null
      for (const part of parts) {
        if (part.inlineData?.data) {
          return { data: part.inlineData.data, mediaType: part.inlineData.mimeType || 'image/png' }
        }
      }
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isOverloaded = msg.includes('503') || msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('high demand')
      if (!isOverloaded || attempt === 4) return null
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30000)
    }
  }
  return null
}
