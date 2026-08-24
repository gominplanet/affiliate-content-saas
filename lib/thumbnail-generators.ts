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
import { createOpenAIService } from '@/services/openai'

export const NANO_BANANA_EDIT = 'fal-ai/nano-banana/edit'
// Nano Banana Pro = Google Gemini 3 Pro Image. Higher fidelity and — crucially
// — reliable, legible BAKED text (it can actually spell), so it's the model we
// use whenever the headline is rendered INTO the image. Pricier than regular
// Nano Banana, so the clean (text-free) path stays on the cheaper model.
export const NANO_BANANA_PRO_EDIT = 'fal-ai/gemini-3-pro-image-preview/edit'
export const IDEOGRAM_V3 = 'fal-ai/ideogram/v3'

// Configure the fal client once at module load. The client is a singleton and
// needs credentials before ANY subscribe/upload — otherwise every call 401s and
// returns null. Some routes (e.g. the YouTube thumbnail route) call fal.config
// themselves, but others (Social Launch Kit) rely on the helpers here, so we
// self-configure to cover every caller. No-op if FAL_KEY is unset.
if (process.env.FAL_KEY) {
  try { fal.config({ credentials: process.env.FAL_KEY }) } catch { /* client sorts it out at call time */ }
}

/** Model keys used for cost telemetry (see lib/ai-usage.ts). */
export const NANO_BANANA_COST_MODEL = 'fal-nano-banana'
export const NANO_BANANA_PRO_COST_MODEL = 'fal-nano-banana-pro'
export const IDEOGRAM_COST_MODEL = 'fal-ideogram-v3'
/** Cost/telemetry model key for the unified gpt-image compose path (2026-08-13
 *  migration off Nano Banana). Medium quality — $0.06/image (see lib/ai-usage
 *  PRICING), which undercuts Nano Banana Pro ($0.13) while unifying every
 *  designed-image surface on gpt-image. */
export const GPT_IMAGE_COMPOSE_COST_MODEL = 'gpt-image-1-medium'
/** Low-quality gpt-image compose — $0.02/image (see lib/ai-usage PRICING).
 *  Used for product / in-article / sticker renders where softness is fine and
 *  speed + cost win; the face surfaces (thumbnails, IG portraits) stay medium. */
export const GPT_IMAGE_COMPOSE_LOW_COST_MODEL = 'gpt-image-1-low'

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

/** Upload a base64 data URL (e.g. a user-supplied reference image) straight to
 *  fal storage and return its fal URL for use as an image reference. Caps size
 *  and validates the shape; returns null on any failure so the caller can drop
 *  the reference. */
export async function uploadDataUrlToFal(dataUrl: string): Promise<string | null> {
  try {
    const m = /^data:([^;]+);base64,([\s\S]+)$/.exec((dataUrl || '').trim())
    if (!m) return null
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length || buf.length > 12 * 1024 * 1024) return null // ~12MB ceiling
    const blob = new Blob([buf], { type: m[1] || 'image/png' })
    return await fal.storage.upload(blob)
  } catch {
    return null
  }
}

// ── Style reference thumbnails ──────────────────────────────────────────────
// Curated YouTube-thumbnail style references passed as input images to Nano
// Banana Pro so the model learns the visual language we want (cinematic
// blue/orange lighting, bold dual-tone text with thick black outlines,
// reviewer-left + product-right composition, arrow callouts). Drop in 3-5
// .jpg files at the paths below — the system silently no-ops on any file
// that doesn't exist, so the route still works before they're uploaded.
//
// Why this matters: Gemini-style multimodal models tune their output to
// match the gestalt of all input images, not just the prompt. Without
// style refs the model defaults to its own "what a thumbnail looks like"
// average, which is sterile-studio-product-shot. With 3+ style refs it
// matches the punch + composition of the references. This is the single
// largest CTR-quality lever in the pipeline.
//
// File naming convention: thumbnail-style-refs/{1,2,3,4,5}.jpg in /public.
// We try up to 5; any 404s are skipped. Recommended count is 3-4.
const STYLE_REF_FILENAMES = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg']

/**
 * Fetch the curated style-reference thumbnails from /public, re-host them to
 * fal, and return up to `max` fal URLs in declaration order. Silently skips
 * any file that 404s, so the route works whether the user has shipped 0, 3,
 * or 5 references — quality just improves as more refs land.
 *
 * `appBaseUrl` should be the absolute origin of the running app
 * (NEXT_PUBLIC_APP_URL, VERCEL_URL, or the request origin). Without it we
 * can't fetch from /public, so we return [].
 */
export async function rehostStyleRefs(appBaseUrl: string | null | undefined, max = 5): Promise<string[]> {
  if (!appBaseUrl) return []
  const base = appBaseUrl.replace(/\/+$/, '')
  const urls = STYLE_REF_FILENAMES.slice(0, max).map(f => `${base}/thumbnail-style-refs/${f}`)
  const out: string[] = []
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue          // 404 = file not uploaded yet, skip
      const url = await fal.storage.upload(await res.blob())
      if (url) out.push(url)
    } catch { /* network hiccup, skip this ref */ }
  }
  return out
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
    const EDGE = 175     // corner multiplier value (175/255 ≈ 0.69 brightness)
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
      // Very slight global darken + richer colour.
      .modulate({ brightness: 0.97, saturation: 1.08 })
      // Gentle contrast lift: small slope + minimal offset — just adds depth.
      .linear(1.05, -4)
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
 * gpt-image compose — the unified replacement for Nano Banana / NB Pro
 * (2026-08-13 migration). Same call shape as composeWithNanoBanana (prompt +
 * fal-reachable reference URLs + aspectRatio + numImages) so call sites swap
 * with a one-line change and keep getting fal URLs back.
 *
 * gpt-image-1 renders only 1024×1024, 1024×1536 and 1536×1024, so for a
 * non-square target we render the nearest standard size and centre-crop to the
 * exact aspect ratio (sharp). Quality defaults to 'medium' ($0.06/image) — the
 * cost-smart tier that still beats NB Pro. Returns fal URLs, [] on failure so
 * callers keep their existing fallbacks.
 */
const GPT_SIZE_DIMS: Record<string, { w: number; h: number }> = {
  '1024x1024': { w: 1024, h: 1024 },
  '1024x1536': { w: 1024, h: 1536 },
  '1536x1024': { w: 1536, h: 1024 },
}
/** Map a Nano-Banana aspect string to a gpt-image render size + exact crop. */
function gptSizeForAspect(aspect: string): {
  size: '1024x1024' | '1024x1536' | '1536x1024'
  cropW: number
  cropH: number
} {
  switch (aspect) {
    case '1:1':  return { size: '1024x1024', cropW: 1024, cropH: 1024 }
    case '3:2':  return { size: '1536x1024', cropW: 1536, cropH: 1024 }
    case '2:3':  return { size: '1024x1536', cropW: 1024, cropH: 1536 }
    case '16:9': return { size: '1536x1024', cropW: 1536, cropH: 864 }
    case '9:16': return { size: '1024x1536', cropW: 864,  cropH: 1536 }
    case '4:5':  return { size: '1024x1536', cropW: 1024, cropH: 1280 }
    case '5:4':  return { size: '1536x1024', cropW: 1280, cropH: 1024 }
    case '4:3':  return { size: '1536x1024', cropW: 1364, cropH: 1024 }
    case '3:4':  return { size: '1024x1536', cropW: 1024, cropH: 1364 }
    default:     return { size: '1536x1024', cropW: 1536, cropH: 1024 }
  }
}
async function fetchRefImage(
  url: string,
  idx: number,
): Promise<{ data: Uint8Array; filename: string; mime: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = new Uint8Array(await res.arrayBuffer())
    const isPng = (res.headers.get('content-type') || '').includes('png')
    return { data, filename: `ref_${idx}.${isPng ? 'png' : 'jpg'}`, mime: isPng ? 'image/png' : 'image/jpeg' }
  } catch { return null }
}
/** Classify a gpt-image failure so the logs say WHY it fell back to fal (the
 *  difference between a config problem and a content refusal). Greppable:
 *  `[gpt-image-compose] render failed [moderation]` etc. */
export function classifyImageError(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  if (/verif|must be verified|organization/.test(m)) return 'org_not_verified'
  if (/moderation|content policy|safety|rejected|not allowed|violat/.test(m)) return 'moderation'
  if (/rate limit|429|too many requests/.test(m)) return 'rate_limit'
  if (/timeout|timed out|econnreset|socket hang|network/.test(m)) return 'timeout'
  if (/invalid image|mode|unsupported|decode/.test(m)) return 'bad_reference'
  if (/billing|quota|insufficient|payment/.test(m)) return 'billing'
  return 'other'
}

export async function composeWithGptImage(opts: {
  prompt: string
  referenceImageUrls: string[]
  aspectRatio?: string
  numImages?: number
  quality?: 'low' | 'medium' | 'high'
  /** transparent → PNG with alpha (for die-cut stickers / cut-outs). */
  transparent?: boolean
}): Promise<string[]> {
  if (opts.referenceImageUrls.length === 0) return []
  const n = Math.min(10, Math.max(1, opts.numImages ?? 1))
  const { size, cropW, cropH } = gptSizeForAspect(opts.aspectRatio ?? '16:9')
  const full = GPT_SIZE_DIMS[size]
  try {
    const refs = (await Promise.all(opts.referenceImageUrls.slice(0, 8).map((u, i) => fetchRefImage(u, i))))
      .filter((r): r is { data: Uint8Array; filename: string; mime: string } => !!r)
    if (refs.length === 0) return []
    const openai = createOpenAIService()
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      try {
        const b64 = await openai.generateWithReferences({
          prompt: opts.prompt,
          images: refs,
          size,
          quality: opts.quality ?? 'medium',
          model: 'gpt-image-1',
          ...(opts.transparent ? { background: 'transparent' as const } : {}),
        })
        let bytes: Buffer = Buffer.from(b64, 'base64')
        // Centre-crop to the exact target aspect when it differs from the render size.
        if (cropW !== full.w || cropH !== full.h) {
          const left = Math.max(0, Math.round((full.w - cropW) / 2))
          const top = Math.max(0, Math.round((full.h - cropH) / 2))
          bytes = await sharp(bytes)
            .extract({ left, top, width: cropW, height: cropH })
            .png()
            .toBuffer()
        }
        const url = await fal.storage.upload(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        if (url) out.push(url)
      } catch (e) {
        console.warn(`[gpt-image-compose] render failed [${classifyImageError(e)}]:`, e instanceof Error ? e.message : String(e))
      }
    }
    return out
  } catch (err) {
    console.warn(`[gpt-image-compose] compose failed [${classifyImageError(err)}]:`, err instanceof Error ? err.message : String(err))
    return []
  }
}

/** fal background-removal models — BiRefNet gives crisper edges (less halo)
 *  than rembg; we try it first and fall back to rembg. Both segment the
 *  salient object, so white INSIDE the badge is preserved (not chroma-keyed). */
export const BIREFNET_MODEL = 'fal-ai/birefnet/v2'
export const REMBG_MODEL = 'fal-ai/imageutils/rembg'

/**
 * Strip the background off a generated badge so it overlays cleanly on video.
 * Returns a transparent-PNG URL, or null on failure (caller can fall back to
 * the original).
 */
export async function removeBackground(imageUrl: string): Promise<string | null> {
  for (const model of [BIREFNET_MODEL, REMBG_MODEL]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe(model as any, {
        input: { image_url: imageUrl },
        pollInterval: 1500,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = result.data as any
      const url = (data?.image?.url as string) || (data?.images?.[0]?.url as string) || null
      if (url) return url
    } catch (err) {
      console.warn(`[bg-removal] ${model} failed:`, err instanceof Error ? err.message : String(err))
    }
  }
  return null
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

/**
 * Generate a WIDE brand banner NATIVELY at 3:1 (1536×512) — Ideogram's widest
 * bucket and its crispest baked headline text. This is the right way to make an
 * extreme-wide banner (X/Bluesky 3:1, LinkedIn 4:1): instead of cropping a 1.5:1
 * design (which slices 62% of the height for 4:1) or centring it on bars, the
 * design is COMPOSED wide from the start, so it fills the frame edge to edge.
 * The caller reserves a clean left zone (to composite the real logo) and trims a
 * gentle ~12.5% for 4:1. Returns a fal CDN URL, or null on failure (caller
 * falls back to the 1.5:1 path). Ideogram clamps any wider request back to 3:1,
 * so we request 3:1 directly.
 */
export async function generateWideBanner(prompt: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(IDEOGRAM_V3 as any, {
      input: {
        prompt,
        // This generates only a TEXT-FREE background + product hero (the headline
        // and logo are baked/composited afterwards). Suppress ALL text so nothing
        // garbled sneaks in.
        negative_prompt: 'text, words, letters, typography, headline, title, subtitle, tagline, caption, paragraph, sentence, label, product label, brand name, logo, wordmark, watermark, signature, screen text, ui, navigation bar, menu, button, gibberish text, blurry text, numbers',
        image_size: { width: 1536, height: 512 },
        rendering_speed: 'QUALITY',
        num_images: 1,
        expand_prompt: false,
      },
      pollInterval: 2000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = ((result.data as any)?.images?.[0]?.url) as string | undefined
    if (!url) console.warn('[wide-banner] ideogram returned no image; data:', JSON.stringify(result.data)?.slice(0, 300))
    return url || null
  } catch (err) {
    console.warn('[wide-banner] ideogram threw:', err instanceof Error ? err.message : String(err))
    return null
  }
}

export const IDEOGRAM_V3_REFRAME = 'fal-ai/ideogram/v3/reframe'

/**
 * "Expand to fit" — outpaint a design out to a wider banner so it fills the
 * whole frame edge-to-edge instead of being cropped (clips content) or centred
 * on bars. No image model outputs an extreme 4:1 natively, so for wide banners
 * we generate the design normally, scale it to the banner's HEIGHT (so the
 * reframe never has to crop vertically), then let Ideogram V3 Reframe generate
 * matching background on the LEFT and RIGHT to reach the exact target width.
 * The original design region is preserved; only the sides are new.
 *
 * Returns the expanded image URL, or null on any failure (caller falls back).
 */
export async function expandBannerToWidth(sourceDataUrl: string, targetW: number, targetH: number): Promise<string | null> {
  try {
    const m = /^data:([^;]+);base64,([\s\S]+)$/.exec((sourceDataUrl || '').trim())
    if (!m) return null
    // Scale to the target height first → the reframe only extends sideways.
    const scaled = await sharp(Buffer.from(m[2], 'base64')).resize({ height: targetH }).png().toBuffer()
    // Pass the image as a data URI — the fal client auto-uploads inline data,
    // so we don't depend on a separate fal.storage.upload (which can fail in
    // Node). Only image_url + image_size are required for reframe.
    const dataUri = `data:image/png;base64,${scaled.toString('base64')}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(IDEOGRAM_V3_REFRAME as any, {
      input: { image_url: dataUri, image_size: { width: targetW, height: targetH } },
      pollInterval: 2000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = ((result.data as any)?.images?.[0]?.url) as string | undefined
    if (!out) console.warn('[expand] reframe returned no image; data:', JSON.stringify(result.data)?.slice(0, 300))
    return out || null
  } catch (err) {
    console.warn('[expand] reframe threw:', err instanceof Error ? err.message : String(err))
    return null
  }
}
