/**
 * Single-pass thumbnail generators (Phase 2 / Track B).
 *
 * Nano Banana (Google Gemini 2.5 Flash Image, `fal-ai/nano-banana/edit`)
 * composes the creator + product + scene from reference images in ONE call —
 * replacing the slow gpt-image portrait → green-screen → rembg → client-side
 * composite chain. It preserves the person's identity natively from the
 * reference photos, so there's no separate cut-out/compositing step. This is
 * the architecture our 20s competitor uses (videoStill + subjectImage +
 * prompt → finished thumbnail).
 *
 * Ideogram v3 (`fal-ai/ideogram/v3`) is the text-forward alternative — used
 * when we want the headline baked into the image with legible typography
 * rather than overlaid client-side.
 *
 * Both are best-effort: they return [] on any failure so the route can fall
 * back to the existing Kontext / Flux Pro paths. The caller is responsible for
 * cost telemetry (one recordUsage per returned image).
 */
import { fal } from '@fal-ai/client'

export const NANO_BANANA_EDIT = 'fal-ai/nano-banana/edit'
// Nano Banana Pro = Google Gemini 3 Pro Image. Higher fidelity and — crucially
// — reliable, legible BAKED text (it can actually spell), so it's the model we
// use whenever the headline is rendered INTO the image. Pricier than regular
// Nano Banana, so the clean (text-free) path stays on the cheaper model.
export const NANO_BANANA_PRO_EDIT = 'fal-ai/gemini-3-pro-image-preview/edit'
export const IDEOGRAM_V3 = 'fal-ai/ideogram/v3'

/** Model keys used for cost telemetry (see lib/ai-usage.ts). */
export const NANO_BANANA_COST_MODEL = 'fal-nano-banana'
export const NANO_BANANA_PRO_COST_MODEL = 'fal-nano-banana-pro'
export const IDEOGRAM_COST_MODEL = 'fal-ideogram-v3'

const BROWSER_UA = 'Mozilla/5.0 (compatible; MVP Affiliate/1.0; +https://www.mvpaffiliate.io)'

/** True if a URL is already hosted on fal (no need to re-host). */
function isFalUrl(u: string): boolean {
  return /(?:[a-z0-9-]+\.)*fal\.(?:media|ai|run)\//i.test(u)
}

/**
 * Re-host a fetchable image URL to fal storage so the model can read it.
 * fal can't reach Supabase/Amazon URLs directly, and even img.youtube.com is
 * more reliable re-hosted — so we normalise every reference through fal
 * storage. Returns null on failure (the caller drops that reference).
 */
export async function rehostToFal(url: string): Promise<string | null> {
  if (isFalUrl(url)) return url
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    return await fal.storage.upload(await res.blob())
  } catch {
    return null
  }
}

/** Re-host many references in parallel, dropping any that fail, de-duped. */
export async function rehostAll(urls: string[]): Promise<string[]> {
  const seen = new Set<string>()
  const unique = urls.filter(u => u && !seen.has(u) && (seen.add(u), true))
  const out = await Promise.all(unique.map(rehostToFal))
  return out.filter((u): u is string => !!u)
}

/**
 * Compose a finished thumbnail from reference images with Nano Banana.
 * `referenceImageUrls` must already be fal-reachable — call `rehostAll` first.
 * Returns up to `numImages` finished composites (best-first ranking happens in
 * the route). [] on failure.
 */
export async function composeWithNanoBanana(opts: {
  prompt: string
  referenceImageUrls: string[]
  aspectRatio?: string
  numImages?: number
}): Promise<string[]> {
  if (opts.referenceImageUrls.length === 0) return []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(NANO_BANANA_EDIT as any, {
      input: {
        prompt: opts.prompt,
        image_urls: opts.referenceImageUrls,
        aspect_ratio: opts.aspectRatio ?? '16:9',
        num_images: Math.min(10, Math.max(1, opts.numImages ?? 1)),
        output_format: 'jpeg',
      },
      pollInterval: 2000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = (result.data as any)?.images as Array<{ url: string }> | undefined
    return (images ?? []).map(i => i.url).filter(Boolean)
  } catch (err) {
    console.warn('[nano-banana] compose failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Compose a finished thumbnail with Nano Banana PRO (Gemini 3 Pro Image).
 * Same call shape as composeWithNanoBanana but on the Pro endpoint — used for
 * the BAKED-text path where legible spelling matters. `referenceImageUrls`
 * must already be fal-reachable (call `rehostAll` first). [] on failure so the
 * caller can fall back to regular Nano Banana.
 */
export async function composeWithNanoBananaPro(opts: {
  prompt: string
  referenceImageUrls: string[]
  aspectRatio?: string
  numImages?: number
}): Promise<string[]> {
  if (opts.referenceImageUrls.length === 0) return []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(NANO_BANANA_PRO_EDIT as any, {
      input: {
        prompt: opts.prompt,
        image_urls: opts.referenceImageUrls,
        aspect_ratio: opts.aspectRatio ?? '16:9',
        num_images: Math.min(10, Math.max(1, opts.numImages ?? 1)),
        output_format: 'jpeg',
      },
      pollInterval: 2000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = (result.data as any)?.images as Array<{ url: string }> | undefined
    return (images ?? []).map(i => i.url).filter(Boolean)
  } catch (err) {
    console.warn('[nano-banana-pro] compose failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Generate text-forward thumbnails with Ideogram v3 (legible baked-in
 * typography). Pure text-to-image — no reference images. [] on failure.
 */
export async function generateWithIdeogram(opts: {
  prompt: string
  numImages?: number
  renderingSpeed?: 'TURBO' | 'BALANCED' | 'QUALITY'
}): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(IDEOGRAM_V3 as any, {
      input: {
        prompt: opts.prompt,
        image_size: 'landscape_16_9',
        num_images: Math.min(10, Math.max(1, opts.numImages ?? 1)),
        rendering_speed: opts.renderingSpeed ?? 'BALANCED',
        expand_prompt: false,
      },
      pollInterval: 2000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = (result.data as any)?.images as Array<{ url: string }> | undefined
    return (images ?? []).map(i => i.url).filter(Boolean)
  } catch (err) {
    console.warn('[ideogram] generate failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}
