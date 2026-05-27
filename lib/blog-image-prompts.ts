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

/**
 * Produce `count` distinct image-generation prompts for the post body.
 * One Haiku call returns scene prompts tied to the article's sections so
 * the photos feel relevant rather than generic — and deliberately varied so
 * no two body images read as the same shot. Falls back to cycling the base
 * lifestyle/setting/hero prompts if the call fails (or for single-image posts).
 */
export async function generateBodyImagePrompts(opts: {
  count: number
  productTitle: string
  headings: string[]
  base: { hero: string; lifestyle: string; setting: string }
  ctx: { userId: string | null; tier: string | null }
}): Promise<string[]> {
  const cycle = (n: number): string[] => {
    const pool = [opts.base.lifestyle, opts.base.setting, opts.base.hero].filter(Boolean)
    if (pool.length === 0) return []
    return Array.from({ length: n }, (_, i) => pool[i % pool.length])
  }
  if (opts.count <= 1) return cycle(opts.count)
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write exactly ${opts.count} distinct image-generation prompts for photos placed throughout a product review article.

PRODUCT: ${opts.productTitle || 'the reviewed product'}
ARTICLE SECTIONS (one image sits above each — match the scene to the section):
${opts.headings.slice(0, opts.count).map((h, i) => `${i + 1}. ${h}`).join('\n')}

RULES:
- Each prompt must be a CLEARLY DIFFERENT photo from the others — vary the SETTING/background, the surface, the lighting and time of day, the camera distance AND the angle (e.g. one tight close-up detail, one in-use lifestyle scene, one wide in-situ environment, one flat-lay). No two may read as the same shot with a small tweak.
- If the product has more than one function or mode, show a DIFFERENT one in each image (e.g. for a water-bottle-with-lantern: one as a bottle in daytime use, one as a glowing lantern at night).
- Each prompt: a clean, realistic editorial product photo of the EXACT product. No packaging, no boxes.
- NO text, letters, logos, or watermarks in the image. NO retailer/marketplace names or logos (no "Amazon"/"Prime"/store logos), no brand signage, no price tags — only the product's own physical branding.
- Each under 35 words.
Return ONLY a JSON array of ${opts.count} strings, nothing else.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'blog_body_image_prompts', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as string[]
      const cleaned = arr.map(s => (s || '').trim()).filter(Boolean)
      if (cleaned.length > 0) {
        // Pad with cycled prompts if Haiku returned fewer than asked.
        while (cleaned.length < opts.count) cleaned.push(cycle(opts.count)[cleaned.length])
        return cleaned.slice(0, opts.count)
      }
    }
  } catch { /* fall through to cycle */ }
  return cycle(opts.count)
}
