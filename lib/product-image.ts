// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pick the cleanest product reference image from an Amazon gallery. The main
// Amazon image is frequently a multi-panel MARKETING COLLAGE (the product
// staged in a kitchen, a closet, with props like cutting boards/plants, plus a
// charging cable) — handing that whole collage to an image model makes it
// re-render a prop (e.g. a cutting board) instead of the actual product. We
// use Claude vision to look across all gallery images and pick the single,
// isolated studio shot of the real product.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

/**
 * Return the gallery image that is the cleanest isolated shot of the actual
 * product (plain background, no scene/collage/props). Falls back to the first
 * image if vision is unavailable or undecided. Returns null only when given no
 * images.
 */
export async function pickProductReferenceImage(
  images: string[],
  title: string,
  ctx?: { userId?: string; tier?: string | null },
): Promise<string | null> {
  const imgs = (images || []).filter(Boolean).slice(0, 7)
  if (imgs.length <= 1) return imgs[0] ?? null

  try {
    const client = createAnthropicClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = imgs.map((url) => ({ type: 'image', source: { type: 'url', url } }))
    content.push({
      type: 'text',
      text: `These are gallery images for the product "${title}", numbered 1-${imgs.length} in order. Pick the ONE image that is the cleanest, single, ISOLATED studio shot of the actual product itself — plain or white background, just the product, the way it would look on its own product page. Reject any image that is a lifestyle scene or a multi-panel marketing collage, that shows the product staged in a room/kitchen/closet, that includes props (cutting boards, plants, utensils, furniture), hands or people, a packaging box, or separate accessories (like a charging cable) as the main subject. Choose the bare product that recurs across the images. Reply with ONLY the image number.`,
    })
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content }],
    })
    if (ctx?.userId) recordAnthropicUsage(resp, { userId: ctx.userId, tier: ctx.tier, feature: 'product_image_pick', model: 'claude-haiku-4-5-20251001' })
    const txt = (resp.content[0] as { type: string; text: string })?.text || ''
    const n = parseInt((txt.match(/\d+/) || [])[0] || '', 10)
    if (n >= 1 && n <= imgs.length) return imgs[n - 1]
    return imgs[0]
  } catch {
    return imgs[0] ?? null
  }
}
