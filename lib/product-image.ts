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

/** Marker we set on `falUrl` when the model wandered too far from the
 *  reference and we fell back to the bare reference image. Lets the caller
 *  log/diagnose without changing the URL contract. */
export const BARE_REFERENCE_FALLBACK = Symbol.for('mvp.image.bareReferenceFallback')

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
      text: `These are gallery images for the product "${title}", numbered 1-${imgs.length} in order. Pick the ONE image that is the cleanest, single, ISOLATED studio shot of the actual product itself — plain or white background, just the product, the way it would look on its own product page.

REJECT any image that has ANY of these traits (these are Amazon A+ Content / marketing composites that pollute downstream image generation):
  - Overlay text on top of the image (titles, headlines, "Ultimate ___", "Premium ___", "Best ___", taglines, feature descriptions)
  - Checkmark badges, circle callouts, or "feature highlight" pills (e.g. round labels saying "Non-Slip Footing", "Stable Frame")
  - Numbered annotations or feature-call-out arrows pointing at parts of the product
  - Side-by-side comparison panels or multi-panel marketing collages
  - Lifestyle scenes where the product is staged with props (cutting boards, plants, hands, furniture, food)
  - Packaging boxes shown as the main subject
  - Separate accessories (e.g. charging cables, mounts) as the main subject
  - Brand/retailer logos overlaid (Amazon, Prime, etc.)

Choose the bare product that recurs across the images on a plain background with NO text or graphic overlays. If literally none of the images is clean, pick the one with the LEAST overlay/marketing pollution.

Reply with ONLY the image number.`,
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

/**
 * Vision-verify that a generated image actually shows the SAME PRODUCT as the
 * reference image. Catches the failure mode where the image model drifted to a
 * "similar but different" product despite an explicit identity-preservation
 * prompt — the exact bug that ships visible to readers on the live blog.
 *
 * Returns:
 *   - match: true   → image shows the same product (in a different scene)
 *   - match: false  → image shows a different product or no recognisable product
 *   - The textual `reason` is what the model said; useful for diagnostics.
 *
 * Network/anthropic errors default to `{ match: true, reason: 'verification-skipped' }`
 * so a transient outage in the verifier never blocks an article from publishing.
 * Treated as "innocent until proven guilty" — only reject when the verifier is
 * confident the products differ.
 */
export async function verifyProductMatch(
  referenceUrl: string,
  generatedUrl: string,
  productTitle: string,
  ctx?: { userId?: string; tier?: string | null },
): Promise<{ match: boolean; reason: string }> {
  if (!referenceUrl || !generatedUrl) return { match: true, reason: 'no-reference-to-compare' }
  try {
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: referenceUrl } },
          { type: 'image', source: { type: 'url', url: generatedUrl } },
          {
            type: 'text',
            text: `Image 1 is the reference photo for the product "${productTitle}". Image 2 is a generated marketing photo that is supposed to show the EXACT same product, just in a different scene/background.

Does Image 2 show the SAME PRODUCT as Image 1 — same shape, same colour/finish, same materials, same on-product branding/text/logos, same overall design? Background, lighting, camera angle, and the surrounding scene are EXPECTED to differ; ignore those when judging.

What we care about: is the product itself the same identifiable item, or did the generator render a similar-but-different product (e.g. a different model in the same category, a generic stand-in, the wrong colour or shape, the wrong cut-out pattern, the wrong number of components)?

Reply with EXACTLY one line in this format:
MATCH: yes/no — <one short reason under 12 words>`,
          },
        ],
      }],
    })
    if (ctx?.userId) recordAnthropicUsage(resp, { userId: ctx.userId, tier: ctx.tier, feature: 'product_image_verify', model: 'claude-haiku-4-5-20251001' })
    const txt = ((resp.content[0] as { type: string; text: string })?.text || '').trim()
    const yes = /MATCH:\s*yes/i.test(txt)
    const reason = txt.replace(/^MATCH:\s*(yes|no)\s*[—:-]\s*/i, '').slice(0, 200).trim() || 'no reason given'
    return { match: yes, reason }
  } catch {
    // Verifier failure shouldn't block the article. Default to "match" so a
    // brief Anthropic outage doesn't reject good images. The vision picker
    // already filtered the input gallery; this is the second-line safety check.
    return { match: true, reason: 'verification-skipped' }
  }
}
