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

/** Generate a branded product thumbnail; returns a hosted PNG URL or null. */
export async function buildProductThumbnail(
  sb: Sb,
  opts: { userId: string; tier?: string | null; title: string; asin: string },
): Promise<string | null> {
  try {
    const product = await fetchAmazonProduct(opts.asin).catch(() => null)
    const productImg = (product?.imageUrl as string | undefined) || null

    // Creator's face (from a ready-enough face model). Optional but preferred.
    const { data: fms } = await sb.from('face_models').select('id,source_images,status').eq('user_id', opts.userId)
    const asStrArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    const withSelfies = ((fms as Array<{ id: string; source_images: unknown; status: string }> | null) || [])
      .map(m => ({ id: m.id, source_images: asStrArr(m.source_images), status: m.status }))
      .filter(m => m.source_images.length > 0)
    const face = withSelfies.find(m => m.status === 'ready') || withSelfies[0]
    const faceRef = face
      ? await getThumbnailFaceRef(sb, opts.userId, { faceId: face.id, sourceImages: face.source_images, expression: 'excited', tier: opts.tier ?? null })
      : null

    const refs = await rehostAll([...(faceRef ? [faceRef] : []), ...(productImg ? [productImg] : [])])
    if (refs.length === 0) return null

    const hook = await shortHook(opts.title, (product?.title as string) || '')
    if (product?.title) {
      recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'product_thumbnail_hook', model: 'claude-haiku-4-5-20251001', images: 0 })
    }

    const faceLine = faceRef ? 'FEATURE THE PERSON from the first reference image (preserve their exact face and likeness), looking excited and gesturing toward the product. Do NOT invent a different person.' : ''
    const prompt = `Design a bold, high-contrast YouTube-style thumbnail (16:9) for a product review.
${faceLine}
Show the PRODUCT from the reference clearly and prominently.
Bake in LARGE, perfectly spelled overlay text reading exactly "${hook}". Bright, punchy, modern, saturated colours, clean composition. No watermark, no extra sentences, no other text.`

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
        const path = `${opts.userId}/thumb-${opts.asin}-${Date.now()}.png`
        const { error: upErr } = await sb.storage.from('instagram-videos').upload(path, bytes, { contentType: 'image/png', upsert: false })
        if (!upErr) hosted = sb.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
      }
    } catch { /* fall back to the fal url below */ }

    recordUsage({ userId: opts.userId, tier: opts.tier ?? null, feature: 'product_thumbnail', model, images: 1 })
    return hosted || imgs[0]
  } catch {
    return null
  }
}
