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
  // The generated image to check: a URL (fal/Gemini-hosted) OR raw base64 bytes
  // (the Pinterest path produces base64 in-memory before it's ever uploaded).
  generated: string | { base64: string; mediaType: string },
  productTitle: string,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<{ match: boolean; reason: string }> {
  if (!referenceUrl || !generated) return { match: true, reason: 'no-reference-to-compare' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatedSource: any = typeof generated === 'string'
    ? { type: 'url', url: generated }
    : { type: 'base64', media_type: generated.mediaType, data: generated.base64 }
  try {
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: referenceUrl } },
          { type: 'image', source: generatedSource },
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

/**
 * Vision-verify that a generated thumbnail shows the SAME PERSON as the
 * creator's own face reference. Privacy- and identity-critical: a rendered
 * thumbnail face must only ever be the user's own likeness, and the compositing
 * model occasionally drifts the identity (loose likeness average, or rendering a
 * generic stand-in). This is the face analogue of verifyProductMatch.
 *
 * Returns match:true when it's confidently the same individual. Anthropic/network
 * errors default to match:true ('verification-skipped') so a transient outage
 * never blocks a thumbnail — innocent until proven guilty, only reject on a
 * confident "different person".
 */
export async function verifyFaceIdentity(
  referenceUrl: string,
  // The generated thumbnail to check: a URL (fal-hosted) OR raw base64 bytes.
  generated: string | { base64: string; mediaType: string },
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<{ match: boolean; reason: string }> {
  if (!referenceUrl || !generated) return { match: true, reason: 'no-reference-to-compare' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatedSource: any = typeof generated === 'string'
    ? { type: 'url', url: generated }
    : { type: 'base64', media_type: generated.mediaType, data: generated.base64 }
  try {
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: referenceUrl } },
          { type: 'image', source: generatedSource },
          {
            type: 'text',
            text: `Image 1 is a reference photo of a specific person (the creator). Image 2 is a generated YouTube thumbnail that is supposed to feature THAT SAME person.

Is the main person shown in Image 2 the SAME individual as in Image 1 — same facial identity, bone structure, and likeness? Hairstyle, expression, lighting, makeup, camera angle and the surrounding scene are EXPECTED to differ; ignore those. Judge identity only.

Answer "no" if Image 2 shows a clearly DIFFERENT person (a generic stand-in, the wrong gender/age/ethnicity, or a loose likeness that isn't really them), OR if Image 2 has no recognisable human face at all.

Reply with EXACTLY one line in this format:
MATCH: yes/no — <one short reason under 12 words>`,
          },
        ],
      }],
    })
    if (ctx?.userId) recordAnthropicUsage(resp, { userId: ctx.userId, tier: ctx.tier, feature: 'yt_thumb_face_verify', model: 'claude-haiku-4-5-20251001' })
    const txt = ((resp.content[0] as { type: string; text: string })?.text || '').trim()
    const yes = /MATCH:\s*yes/i.test(txt)
    const reason = txt.replace(/^MATCH:\s*(yes|no)\s*[—:-]\s*/i, '').slice(0, 200).trim() || 'no reason given'
    return { match: yes, reason }
  } catch {
    return { match: true, reason: 'verification-skipped' }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toImageSource(generated: string | { base64: string; mediaType: string }): any {
  return typeof generated === 'string'
    ? { type: 'url', url: generated }
    : { type: 'base64', media_type: generated.mediaType, data: generated.base64 }
}

/**
 * Vision proof-check for text BAKED INTO an image (a thumbnail headline the
 * image model rendered, vs our pixel-perfect Satori overlay). Image models
 * routinely misspell — "REVEIW", "TESETD", dropped/doubled letters. Also flags
 * the banned word "HONEST" if it rendered inside the image (the text-only
 * scrubber can't see pixels). Returns ok:false ONLY on a confident typo / banned
 * word so a good thumbnail is never rejected by a flaky read. Fail-open on error.
 */
export async function verifyBakedText(
  generated: string | { base64: string; mediaType: string },
  intendedText: string,
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<{ ok: boolean; reason: string }> {
  const intended = (intendedText || '').trim()
  if (!generated || !intended) return { ok: true, reason: 'nothing-to-check' }
  try {
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: toImageSource(generated) },
          {
            type: 'text',
            text: `This image has a large headline baked into it. The headline is SUPPOSED to read exactly: "${intended}".

Read the actual headline text in the image. Two checks:
1) SPELLING: is every word spelled correctly with no typos, missing letters, doubled letters, or garbled/nonsense characters? Minor differences in line breaks, capitalization or trailing punctuation are FINE — only flag real misspellings or garbled letterforms.
2) BANNED: does ANY visible text in the image contain the word "HONEST" (in any casing)?

Reply with EXACTLY one line:
OK: yes/no — <under 12 words: the misspelling, or "HONEST present", or "clean">`,
          },
        ],
      }],
    })
    if (ctx?.userId) recordAnthropicUsage(resp, { userId: ctx.userId, tier: ctx.tier, feature: 'image_baked_text_verify', model: 'claude-haiku-4-5-20251001' })
    const txt = ((resp.content[0] as { type: string; text: string })?.text || '').trim()
    const ok = /OK:\s*yes/i.test(txt)
    const reason = txt.replace(/^OK:\s*(yes|no)\s*[—:-]\s*/i, '').slice(0, 200).trim() || 'no reason given'
    return { ok, reason }
  } catch {
    return { ok: true, reason: 'verification-skipped' }
  }
}

/**
 * Vision compliance scan for BRAND LEAKS in a generated image. Every image
 * prompt forbids retailer/marketplace logos (Amazon, Prime, Walmart, eBay),
 * store watermarks, and ™/© symbols — but nothing verified the model obeyed.
 * Returns clean:false ONLY on a confident, readable brand mark (the product's
 * OWN physical branding is allowed and must NOT trip it). Fail-open on error.
 */
export async function verifyNoBrandLeak(
  generated: string | { base64: string; mediaType: string },
  ctx?: { userId?: string | null; tier?: string | null },
): Promise<{ clean: boolean; reason: string }> {
  if (!generated) return { clean: true, reason: 'nothing-to-check' }
  try {
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: toImageSource(generated) },
          {
            type: 'text',
            text: `Compliance check for a marketing image. Look ONLY for things that should NOT be here:
- A RETAILER / MARKETPLACE logo or wordmark: Amazon, Amazon smile arrow, "Prime", Walmart, eBay, Target, Best Buy, etc.
- A store/site watermark or overlaid copyright/trademark symbol (™, ©, ®) used as a graphic.
- An obvious third-party brand logo unrelated to the product itself.

The product's OWN physical branding printed on the product is ALLOWED — do NOT flag that. Only flag retailer/marketplace/watermark leaks.

Reply with EXACTLY one line:
CLEAN: yes/no — <under 12 words: which logo/watermark, or "none">`,
          },
        ],
      }],
    })
    if (ctx?.userId) recordAnthropicUsage(resp, { userId: ctx.userId, tier: ctx.tier, feature: 'image_brand_leak_verify', model: 'claude-haiku-4-5-20251001' })
    const txt = ((resp.content[0] as { type: string; text: string })?.text || '').trim()
    const clean = /CLEAN:\s*yes/i.test(txt)
    const reason = txt.replace(/^CLEAN:\s*(yes|no)\s*[—:-]\s*/i, '').slice(0, 200).trim() || 'no reason given'
    return { clean, reason }
  } catch {
    return { clean: true, reason: 'verification-skipped' }
  }
}

/** Majority-vote a yes/no verifier `votes` times (default 3) for a stronger
 *  guarantee on the ONE image that actually publishes. Each vote is an
 *  independent Claude call; passes when ≥ ceil(votes/2) affirm. Fail-open votes
 *  count as "yes" so an Anthropic blip never rejects a good image. */
export async function verifyProductMatchConsensus(
  referenceUrl: string,
  generated: string | { base64: string; mediaType: string },
  productTitle: string,
  ctx?: { userId?: string | null; tier?: string | null },
  votes = 3,
): Promise<{ match: boolean; yes: number; votes: number }> {
  if (!referenceUrl || !generated) return { match: true, yes: votes, votes }
  const rs = await Promise.all(Array.from({ length: votes }, () => verifyProductMatch(referenceUrl, generated, productTitle, ctx)))
  const yes = rs.filter(r => r.match).length
  return { match: yes >= Math.ceil(votes / 2), yes, votes }
}

/** Majority-vote the face-identity check (see verifyProductMatchConsensus). */
export async function verifyFaceIdentityConsensus(
  referenceUrl: string,
  generated: string | { base64: string; mediaType: string },
  ctx?: { userId?: string | null; tier?: string | null },
  votes = 3,
): Promise<{ match: boolean; yes: number; votes: number }> {
  if (!referenceUrl || !generated) return { match: true, yes: votes, votes }
  const rs = await Promise.all(Array.from({ length: votes }, () => verifyFaceIdentity(referenceUrl, generated, ctx)))
  const yes = rs.filter(r => r.match).length
  return { match: yes >= Math.ceil(votes / 2), yes, votes }
}
