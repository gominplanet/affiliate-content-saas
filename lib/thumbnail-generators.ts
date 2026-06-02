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
import sharp from 'sharp'

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

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

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
 * Force-moody post-process. A deterministic, server-side cinematic grade applied
 * to a FINISHED thumbnail: a slight darken + saturation lift, a contrast bump,
 * and a radial vignette (bright centre → dark edges). This guarantees a moody,
 * higher-contrast background on EVERY thumbnail regardless of what the model
 * rendered — which both reads as more "clickable" and hides any faint cut-out
 * edge/halo around the composited creator. The bright centre keeps the face and
 * product lit while the background falls off; overlaid (or baked) bright
 * headline text pops harder against the darker frame.
 *
 * Best-effort: fetches the image, grades it with sharp, re-hosts the result to
 * fal storage and returns the new URL. Returns the ORIGINAL url unchanged on any
 * failure (bad fetch, decode error, upload error) so the caller never loses a
 * thumbnail to the grade.
 */
export async function applyMoodyGrade(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return url
    const input = Buffer.from(await res.arrayBuffer())

    const base = sharp(input)
    const meta = await base.metadata()
    const w = meta.width ?? 1280
    const h = meta.height ?? 720

    // Radial vignette computed as a RAW pixel buffer (deliberately NOT an SVG):
    // SVG gradients depend on librsvg being present and behaving identically in
    // the serverless runtime, which isn't guaranteed. This is pure pixel math +
    // a core libvips multiply, so it's identical on every runtime. White (255 =
    // no change under multiply) through the centre where the face + product sit,
    // falling to a mid-grey at the corners so the background darkens. cy is
    // biased up (42%) so the chest-up subject stays in the bright zone.
    const cx = w * 0.5, cy = h * 0.42
    const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
    const INNER = 0.45   // inner fraction of the radius kept fully bright
    const EDGE = 120     // corner multiplier value (120/255 ≈ 0.47 brightness)
    const vig = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxR
        let v = 255
        if (d > INNER) {
          const t = Math.min(1, (d - INNER) / (1 - INNER))
          v = Math.round(255 - t * (255 - EDGE))
        }
        const i = (y * w + x) * 3
        vig[i] = vig[i + 1] = vig[i + 2] = v
      }
    }

    const out = await base
      // Slight global darken + richer colour.
      .modulate({ brightness: 0.94, saturation: 1.12 })
      // Contrast bump: slope > 1 with a negative offset deepens the shadows.
      .linear(1.12, -12)
      // Multiply the vignette so the centre is untouched and the edges fall off.
      .composite([{ input: vig, raw: { width: w, height: h, channels: 3 }, blend: 'multiply' }])
      .jpeg({ quality: 90 })
      .toBuffer()

    // Wrap in a fresh Uint8Array so the Blob part is backed by a plain
    // ArrayBuffer (sharp's Buffer is typed ArrayBufferLike, not a valid BlobPart).
    const newUrl = await fal.storage.upload(new Blob([new Uint8Array(out)], { type: 'image/jpeg' }))
    return newUrl || url
  } catch (err) {
    console.warn('[moody-grade] failed:', err instanceof Error ? err.message : String(err))
    return url
  }
}

/**
 * Re-host a face model's source photos (paths in the `headshots` bucket) to fal
 * so they can be passed as identity references to Nano Banana Pro — the
 * "Your Face" likeness lever, shared by the YouTube + Instagram paths.
 * Best-effort: skips any photo that won't download.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rehostFacePhotos(supabase: any, paths: string[], max = 3): Promise<string[]> {
  const out: string[] = []
  for (const path of (paths || []).slice(0, max)) {
    try {
      const { data: file } = await supabase.storage.from('headshots').download(path)
      if (!file) continue
      const url = await fal.storage.upload(file as Blob)
      if (url) out.push(url)
    } catch { /* skip unreadable photo */ }
  }
  return out
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
