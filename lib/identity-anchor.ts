// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
import { fal } from '@fal-ai/client'
import { createHash } from 'crypto'
import { createOpenAIService, OpenAIService, normalizeToPng } from '@/services/openai'
import { recordUsage } from '@/lib/ai-usage'

const BUCKET = 'headshots'

/** Facial expression for the anchor. The energetic ones make punchy thumbnail
 *  faces; `neutral` is the default for headshots / IG / general likeness. */
export const ANCHOR_EXPRESSIONS: Record<string, string> = {
  neutral:   'a relaxed, confident expression',
  happy:     'a warm, genuine smile — friendly and approachable',
  excited:   'visibly excited and energetic — bright wide eyes and a big enthusiastic smile',
  surprised: 'a genuine surprised reaction — eyebrows raised, eyes wide, mouth slightly open in a "wow"',
  laughing:  'laughing naturally — joyful and candid, eyes lit up',
  focused:   'focused and determined — calm intensity',
  serious:   'serious and composed — confident, no smile',
  angry:     'an intense, fired-up reaction — furrowed brow, strong emotion',
}

/** Stable cache key for a face's photo set + expression — changes when the
 *  photos change, so a re-uploaded "Your Face" regenerates anchors next time.
 *  Neutral keeps the bare key, backward-compatible with already-cached anchors. */
function anchorKey(userId: string, sourceImages: string[], expression: string): string {
  const h = createHash('sha1').update(sourceImages.join('|')).digest('hex').slice(0, 12)
  const suffix = expression && expression !== 'neutral' ? `-${expression}` : ''
  return `${userId}/anchors/${h}${suffix}.png`
}

// Same identity-lock discipline as the Photobooth, distilled to a clean,
// composite-friendly reference portrait (neutral backdrop, even light, centred).
function buildAnchorPrompt(expression: string): string {
  const expr = ANCHOR_EXPRESSIONS[expression] || ANCHOR_EXPRESSIONS.neutral
  return `Professional head-and-shoulders portrait, photorealistic, high resolution.

REFERENCE IMAGES: use these ONLY to capture the MAIN subject's exact facial identity, hair, and likeness. The photos may also contain OTHER people — IGNORE everyone else; lock onto the single most prominent main subject (the largest, most central face).
IDENTITY (critical): render EXACTLY that one person, completely ALONE. Do NOT blend, merge, average, or mix in any other face. ONLY ONE person in the output — no second person, partner, companion, or any extra face/head/shoulder/arm anywhere in the frame. It must be unmistakably the same individual — flattering but clearly them.
SHOT: head-and-shoulders, person centred, facing the camera, ${expr}, natural realistic skin texture (NOT plastic or over-retouched), flattering even studio lighting, sharp focus on the eyes, on a clean evenly-lit neutral light-grey backdrop.
Do NOT render any text, captions, watermarks, or logos.`
}

/**
 * Photobooth-quality "identity anchor": one clean, identity-locked solo portrait
 * of the face, rendered by gpt-image from the user's "Your Face" photos and
 * CACHED in the headshots bucket (keyed by the photo set). It's reused as the
 * single high-fidelity identity reference for every thumbnail / IG composite —
 * far better than handing the composite model the raw, varied selfies, which is
 * why composited faces previously looked worse than the Photobooth.
 *
 * Returns a fal-reachable URL (ready to pass to Nano Banana), or null on any
 * failure so the caller falls back to the raw face photos.
 */
export async function getOrCreateIdentityAnchor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  sourceImages: string[],
  ctx?: { tier?: string | null; expression?: string },
): Promise<string | null> {
  if (!userId || !Array.isArray(sourceImages) || sourceImages.length === 0) return null
  const expression = (ctx?.expression && ANCHOR_EXPRESSIONS[ctx.expression]) ? ctx.expression : 'neutral'
  const path = anchorKey(userId, sourceImages, expression)

  // 1. Reuse a cached anchor if we've already built one for this exact photo set.
  try {
    const { data: cached } = await supabase.storage.from(BUCKET).download(path)
    if (cached) {
      const url = await fal.storage.upload(cached as Blob)
      if (url) return url
    }
  } catch { /* nothing cached yet — build it below */ }

  // 2. Build it with gpt-image from the face photos (Photobooth-grade).
  try {
    const refImages: Array<{ data: Uint8Array; filename: string; mime: string }> = []
    for (const p of sourceImages.slice(0, 5)) {
      try {
        const { data: file } = await supabase.storage.from(BUCKET).download(p)
        if (!file) continue
        const png = await normalizeToPng(new Uint8Array(await (file as Blob).arrayBuffer()))
        refImages.push({ data: png, filename: `face_${refImages.length}.png`, mime: 'image/png' })
      } catch { /* skip unreadable photo */ }
    }
    if (refImages.length === 0) return null

    const model = OpenAIService.imageModel()
    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({ prompt: buildAnchorPrompt(expression), images: refImages, size: '1024x1024', quality: 'high', model })
    recordUsage({ userId, tier: ctx?.tier ?? null, feature: 'identity_anchor_image', model, images: 1 })

    const bytes = Buffer.from(b64, 'base64')
    // Cache for reuse (best-effort; non-fatal if storage write fails).
    try { await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true }) } catch { /* keep going */ }
    const url = await fal.storage.upload(new Blob([bytes], { type: 'image/png' }))
    return url || null
  } catch (e) {
    console.warn('[identity-anchor] build failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}
