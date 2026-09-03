// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Build a branded product thumbnail from an ASIN + the creator's face, for the
// file-first Launchpad flow where the video never touches YouTube (so the normal
// YouTube-video thumbnail pipeline can't run). Features the creator (from their
// face model) next to the real product, with a short baked hook. Best-effort:
// returns null when there's nothing to work with, so the caller carries on.

import { fetchAmazonProduct } from '@/services/amazon'
import { getThumbnailFaceRef } from '@/lib/identity-anchor'
import { rehostAll, composeWithNanoBananaPro, composeWithNanoBanana } from '@/lib/thumbnail-generators'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** A short, punchy 2-4 word overlay hook for the thumbnail, from the video +
 *  product. Falls back to the first words of the title. */
async function shortHook(title: string, productTitle: string): Promise<string> {
  const fallback = (title || productTitle || 'TOP PICK').replace(/[^\w &!?]/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ').toUpperCase() || 'TOP PICK'
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 40,
      messages: [{ role: 'user', content: `Video: "${title}"\nProduct: "${productTitle}"\n\nWrite a 2-4 word, high-contrast thumbnail overlay (ALL CAPS, punchy, no punctuation except ! or ?). Reply with ONLY the words.` }],
    })
    let raw = ''
    for (const b of msg.content) if (b.type === 'text') raw += b.text
    const hook = raw.trim().replace(/^["']|["']$/g, '').toUpperCase().slice(0, 28)
    return hook.length >= 2 ? hook : fallback
  } catch { return fallback }
}

/** Generate a branded product thumbnail; returns a hosted PNG URL or null.
 *  `withText` (default true) bakes the English hook into the image. Pass false
 *  for the clean, wordless variant delivered to non-English storefronts. */
export async function buildProductThumbnail(
  sb: Sb,
  opts: {
    userId: string; tier?: string | null; title: string; asin: string; withText?: boolean
    /** Use THIS saved face (face_models.id). Falls back to the first ready face if
     *  it isn't found. */
    faceId?: string | null
    /** Product only — no creator in the frame at all. */
    noHuman?: boolean
  },
): Promise<string | null> {
  const withText = opts.withText !== false
  try {
    const product = await fetchAmazonProduct(opts.asin).catch(() => null)
    // Feed the model the REAL product photos (main + one more angle) so it
    // reproduces the actual item, not a generic stand-in. Falls back to the
    // single main image.
    const gallery = Array.isArray(product?.images) ? (product!.images as string[]).filter(Boolean) : []
    const productImgs = (gallery.length ? gallery : [product?.imageUrl]).filter((u): u is string => !!u).slice(0, 2)
    if (productImgs.length === 0) {
      console.error('[buildProductThumbnail] no product image for ASIN', opts.asin, '— the model will invent a product; check the Amazon fetch')
    }

    // Creator's face (from a ready-enough face model). Optional but preferred.
    const { data: fms } = await sb.from('face_models').select('id,source_images,status,outfit_pref').eq('user_id', opts.userId)
    const asStrArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    const withSelfies = ((fms as Array<{ id: string; source_images: unknown; status: string; outfit_pref: string | null }> | null) || [])
      .map(m => ({ id: m.id, source_images: asStrArr(m.source_images), status: m.status, outfit_pref: m.outfit_pref ?? null }))
      .filter(m => m.source_images.length > 0)
    // Honour the creator's pick: the exact face they chose, or nobody at all.
    // Otherwise the first ready face (the original behaviour).
    const face = opts.noHuman
      ? undefined
      : (opts.faceId ? withSelfies.find(m => m.id === opts.faceId) : undefined)
        || withSelfies.find(m => m.status === 'ready')
        || withSelfies[0]
    const faceRef = face
      ? await getThumbnailFaceRef(sb, opts.userId, { faceId: face.id, sourceImages: face.source_images, expression: 'excited', tier: opts.tier ?? null, wardrobe: face.outfit_pref })
      : null

    const refs = await rehostAll([...(faceRef ? [faceRef] : []), ...productImgs])
    if (refs.length === 0) return null

    // The hook is baked into the image by the generator, so it only applies to
    // the text variant. The clean variant (non-English storefronts) carries no
    // words at all, so we skip the hook call entirely.
    const hook = withText ? await shortHook(opts.title, (product?.title as string) || '') : ''
    if (withText && product?.title) {
      recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'product_thumbnail_hook', model: 'claude-haiku-4-5-20251001', images: 0 })
    }

    const productName = ((product?.title as string) || '').trim().slice(0, 120)
    const faceLine = faceRef
      ? 'The FIRST reference image is the CREATOR. Feature this exact person (preserve their real face and likeness), looking excited and gesturing toward the product. Do NOT invent a different person. '
      : ''
    // Bind the product as strictly as the face: the real photos are the source of
    // truth for the item's form factor. Without this the model drifts to a generic
    // stand-in (e.g. drawing over-ear headphones when the product is neckband
    // earbuds) — the exact bug this guards against.
    const productLine = `The ${faceRef ? 'other reference image(s) are' : 'reference image(s) are'} the ACTUAL product being reviewed${productName ? ` ("${productName}")` : ''}. Reproduce THAT exact product faithfully — same category, form factor, shape, colour and design — large and prominent. Do NOT substitute, redesign, or invent a different product, and do NOT change its form factor (for example, if it is neckband or in-ear earbuds, do NOT draw over-ear headphones). `
    const textLine = withText
      ? `Bake in LARGE, perfectly spelled overlay text reading exactly "${hook}" and nothing else — no subtitle, no second line, no other words. `
      : 'Do NOT put ANY text, words, letters, captions or logos anywhere on the image. '
    const prompt = `Design a bold, high-contrast YouTube-style thumbnail (16:9) for a product review.
${faceLine}${productLine}${textLine}Bright, punchy, modern, saturated colours, clean composition. No watermark.`

    let imgs = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 })
    let model = 'nano-banana-pro'
    if (!imgs[0]) { imgs = await composeWithNanoBanana({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }); model = 'nano-banana' }
    if (!imgs[0]) return null

    // Rehost the ephemeral fal URL to our storage so it's a stable thumbnail.
    let hosted: string | null = null
    try {
      const res = await fetch(imgs[0])
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer())
        const path = `${opts.userId}/thumb-${withText ? '' : 'clean-'}${opts.asin}-${Date.now()}.png`
        const { error: upErr } = await sb.storage.from('instagram-videos').upload(path, bytes, { contentType: 'image/png', upsert: false })
        if (!upErr) hosted = sb.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      }
    } catch { /* fall back to the fal url below */ }

    recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: withText ? 'product_thumbnail' : 'product_thumbnail_clean', model, images: 1 })
    return hosted || imgs[0]
  } catch {
    return null
  }
}
