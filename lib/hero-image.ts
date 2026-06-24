// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
import sharp from 'sharp'
import { createOpenAIService } from '@/services/openai'
import { recordUsage } from '@/lib/ai-usage'
import { verifyProductMatch } from '@/lib/product-image'

/**
 * Builds the 16:9 featured image for a campaign post.
 *
 * Campaign posts used the raw Amazon product photo (square/portrait) as
 * the WP featured image — never 16:9, so it cropped badly in themes and
 * social cards. This produces a guaranteed 1280x720 image:
 *
 *   1. Primary — an AI hero from the generated hero prompt (DALL-E
 *      1792x1024, then cover-cropped to exact 16:9).
 *   2. Fallback — the product photo letterboxed (contain) onto a clean
 *      white 16:9 canvas, so the result is ALWAYS 16:9 even with no
 *      OpenAI key or a DALL-E failure.
 *
 * Returns null only if both paths fail; the caller then publishes
 * without a featured image (non-fatal, same as before).
 */

const W = 1280
const H = 720

export interface HeroImage {
  b64: string
  mime: 'image/jpeg'
  /** Which path produced it — surfaced per-post so a silent fallback
   *  is visible instead of a mystery. */
  kind: 'ai' | 'product'
}

export async function buildCampaignHero(opts: {
  heroPrompt: string | null | undefined
  productImageUrl: string | null | undefined
  /** Product name — used to ground the Claude vision right-product check. */
  productTitle?: string | null
  ctx?: { userId?: string | null; tier?: string | null }
}): Promise<HeroImage | null> {
  const { heroPrompt, productImageUrl, productTitle, ctx } = opts

  // ── Primary: AI hero ──────────────────────────────────────────────
  if (heroPrompt && process.env.OPENAI_API_KEY) {
    // Up to 2 attempts: render → Claude-vision verify it shows the RIGHT
    // product (when we have a real product photo to compare against). On a
    // confident mismatch, regenerate once; if it STILL doesn't match, fall
    // through to the product-photo floor rather than ship the wrong product.
    // Mirrors the Pinterest/Instagram/blog QC gate so every product-image
    // generator is double-checked, not just those four.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const b64 = await createOpenAIService().generateHeroImage(heroPrompt)
        recordUsage({
          userId: ctx?.userId, tier: ctx?.tier,
          // 1792x1024 standard quality — priced at $0.08 in PRICING.
          feature: 'campaign_hero_image', model: 'dall-e-3-1792', images: 1,
        })
        const jpeg = await sharp(Buffer.from(b64, 'base64'))
          .resize(W, H, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 86 })
          .toBuffer()
        const heroB64 = jpeg.toString('base64')

        // No reference photo → nothing to verify against; accept it.
        if (!productImageUrl) {
          return { b64: heroB64, mime: 'image/jpeg', kind: 'ai' }
        }
        const verdict = await verifyProductMatch(
          productImageUrl,
          { base64: heroB64, mediaType: 'image/jpeg' },
          productTitle || 'this product',
          { userId: ctx?.userId ?? null, tier: ctx?.tier ?? null },
        )
        if (verdict.match) return { b64: heroB64, mime: 'image/jpeg', kind: 'ai' }
        // Mismatch: on the last attempt, drop to the product-photo floor below.
        if (attempt === 1) break
        // else loop and regenerate once.
      } catch {
        break // generation/verify failed — fall through to the fallback
      }
    }
  }

  // ── Fallback: product photo, letterboxed to a clean 16:9 canvas ───
  if (productImageUrl) {
    try {
      const res = await fetch(productImageUrl)
      if (res.ok) {
        const src = Buffer.from(await res.arrayBuffer())
        const fitted = await sharp(src)
          .resize(W, H, { fit: 'inside', withoutEnlargement: false })
          .toBuffer()
        const jpeg = await sharp({
          create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .composite([{ input: fitted, gravity: 'centre' }])
          .jpeg({ quality: 86 })
          .toBuffer()
        return { b64: jpeg.toString('base64'), mime: 'image/jpeg', kind: 'product' }
      }
    } catch {
      /* give up — caller publishes without a featured image */
    }
  }

  return null
}
