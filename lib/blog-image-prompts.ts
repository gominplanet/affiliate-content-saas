// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Shared in-article image-prompt helpers. Used by BOTH the blog generation
// route (app/api/blog/generate) and the "Refresh images" route
// (app/api/blog/refresh-images) so the two paths can never drift apart again
// — a single source of truth for how body images are framed and varied.
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

/** Camera perspectives cycled across a post's body images so consecutive
 *  shots differ in framing/angle. Index by image position (i % length). */
export const SHOT_PERSPECTIVES = [
  'extreme close-up macro detail shot, shallow depth of field, product fills the frame',
  'wide environmental shot — the product small within a full real-room setting, lots of context',
  'overhead top-down flat-lay on a clean surface, styled with a few relevant props',
  'in-hand point-of-view shot — the product held and actively being used',
  'three-quarter angle on a wooden table with soft directional side lighting',
  'low hero angle looking slightly up at the product against a softly blurred lifestyle background',
]

/** Pull the H2/H3 heading texts from the body, in order — used as context
 *  so each generated image relates to the section it sits above. */
export function sectionHeadings(content: string): string[] {
  const out: string[] = []
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const t = m[1].replace(/<[^>]+>/g, '').trim()
    if (t) out.push(t)
  }
  return out
}

/** Output shape for `generateBodyImagePrompts`. Each in-article slot now
 *  carries BOTH the image-generation prompt AND a hand-written alt text. The
 *  alt is what gets baked into `<img alt="...">` for screen readers + image
 *  SEO — same Haiku call writes both so they're consistent and the alt
 *  reflects what's actually in the photo. */
export interface BodyImageSlot {
  /** Prompt fed to fal (Kontext / Nano Banana / Flux Pro) to render the image. */
  prompt: string
  /** Descriptive alt text for this specific image — concise, includes the
   *  product name naturally, describes what's IN the photo. */
  alt: string
}

/**
 * Produce `count` distinct image-generation prompts + matching alt texts for
 * the post body. One Haiku call returns scene prompts tied to the article's
 * sections so the photos feel relevant rather than generic — and deliberately
 * varied so no two body images read as the same shot. The alt is written by
 * Haiku in the same call so it accurately describes that exact image (proper
 * image SEO instead of generic "Product — close-up detail" placeholders).
 * Falls back to cycling the base lifestyle/setting/hero prompts if the call
 * fails (or for single-image posts).
 */
export async function generateBodyImagePrompts(opts: {
  count: number
  productTitle: string
  headings: string[]
  base: { hero: string; lifestyle: string; setting: string }
  ctx: { userId: string | null; tier: string | null }
}): Promise<BodyImageSlot[]> {
  const fallbackAlt = (prompt: string, i: number): string => {
    // Pull a short subject phrase from the prompt — first ~80 chars of the
    // first sentence, with the product name prepended if it isn't already
    // present. Keeps fallback alts descriptive rather than "image 1".
    const first = (prompt || '').split(/[.!?]\s/)[0].trim().slice(0, 90)
    const subject = first || `${opts.productTitle || 'product'} review photo ${i + 1}`
    const hasName = opts.productTitle && subject.toLowerCase().includes(opts.productTitle.toLowerCase())
    return (hasName || !opts.productTitle ? subject : `${opts.productTitle}: ${subject}`).slice(0, 120)
  }
  const cycle = (n: number): BodyImageSlot[] => {
    const pool = [opts.base.lifestyle, opts.base.setting, opts.base.hero].filter(Boolean)
    if (pool.length === 0) return []
    return Array.from({ length: n }, (_, i) => {
      const prompt = pool[i % pool.length]
      return { prompt, alt: fallbackAlt(prompt, i) }
    })
  }
  if (opts.count <= 1) return cycle(opts.count)
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Write exactly ${opts.count} distinct in-article images for a product review. For EACH image return both an image-generation prompt AND a concise alt text for that exact photo.

PRODUCT: ${opts.productTitle || 'the reviewed product'}
ARTICLE SECTIONS (one image sits above each — match the scene to the section):
${opts.headings.slice(0, opts.count).map((h, i) => `${i + 1}. ${h}`).join('\n')}

RULES FOR EACH IMAGE PROMPT:
- A CLEARLY DIFFERENT photo from the others — vary the SETTING/background, the surface, the lighting and time of day, the camera distance AND the angle (e.g. one tight close-up detail, one in-use lifestyle scene, one wide in-situ environment, one flat-lay). No two may read as the same shot with a small tweak.
- If the product has more than one function or mode, show a DIFFERENT one in each image (e.g. for a water-bottle-with-lantern: one as a bottle in daytime use, one as a glowing lantern at night).
- A clean, realistic editorial product photo of the EXACT product. No packaging, no boxes.
- NO text, letters, logos, or watermarks in the image. NO retailer/marketplace names or logos (no "Amazon"/"Prime"/store logos), no brand signage, no price tags — only the product's own physical branding.
- Under 35 words.

RULES FOR EACH ALT TEXT (this is what goes in <img alt="…"> — image SEO + accessibility):
- Describe WHAT IS LITERALLY IN THE PHOTO — the subject, the setting, the angle/framing if distinctive. Not a marketing tagline.
- Include the product name naturally (don't keyword-stuff). If the product name is long, use the short form.
- Under 110 characters. One short sentence. No quotes, no surrounding period.
- Each image's alt MUST be different — same image generating the same alt is the bug we're fixing.
- Plain English. Don't write "alt: …" or "image of …" — just the description.

Return ONLY a JSON array of ${opts.count} objects, each shaped exactly:
{ "prompt": "the image-generation prompt", "alt": "the alt text" }
No prose around the array.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'blog_body_image_prompts', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Array<{ prompt?: string; alt?: string } | string>
      const cleaned: BodyImageSlot[] = arr.map((item, i) => {
        // Tolerate the older string-only format too — if Haiku returned a
        // bare string for any slot we fall back to a derived alt.
        if (typeof item === 'string') {
          return { prompt: item.trim(), alt: fallbackAlt(item, i) }
        }
        const prompt = (item.prompt || '').trim()
        const alt = (item.alt || '').trim().replace(/^["']|["']$/g, '').slice(0, 130)
        return { prompt, alt: alt || fallbackAlt(prompt, i) }
      }).filter(s => s.prompt)
      if (cleaned.length > 0) {
        // Pad with cycled prompts if Haiku returned fewer than asked.
        const filler = cycle(opts.count)
        while (cleaned.length < opts.count) cleaned.push(filler[cleaned.length])
        return cleaned.slice(0, opts.count)
      }
    }
  } catch { /* fall through to cycle */ }
  return cycle(opts.count)
}
