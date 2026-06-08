// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// bakeSimpleHeadline — composites the Gemini-spec thumbnail elements:
// neon border, person cutout, and headline text onto an NB Pro base.
//
// Architecture (2026-06-08, after the Resvg-text bug):
//   - Border + cutout = raw SVG → Resvg (no text, just shapes — works)
//   - Headline text   = Satori → resvg via renderDesignerOverlay
//                       (Satori converts text glyphs to <path> elements
//                        BEFORE Resvg sees them, sidestepping Resvg's
//                        unreliable font-family resolution)
//   - Final composite = sharp layers base → border → cutout → text
//
// Why we went through several text-rendering attempts:
//   1. Sharp + raw SVG: needed OS-level fontconfig (no Vercel)
//   2. Resvg + raw SVG with font-family: 'BakeDisplay' alias — font lookup failed
//   3. Resvg + inline attributes with font-family: 'Anton' — still silent fail,
//      probably WOFF parser issue or family-name mismatch in serverless
//   4. CURRENT: Satori-rendered text overlay on transparent base, composited
//      with sharp. Satori embeds Anton glyphs as SVG <path> elements at
//      Satori-output time, so Resvg never has to do font matching.
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { renderDesignerOverlay } from '@/lib/thumbnail-text-templates'

export interface ThumbCopyForBake {
  line1: string
  line2: string
  emphasisWord: string
}

export interface BakeOptions {
  width?: number
  height?: number
  /** Which corner the headline anchors in. Pass 'upper-right' when the
   *  product sits on the LEFT of the frame. Default upper-left. */
  anchor?: 'upper-left' | 'upper-right'
  /** Optional foreground PNG (e.g. rembg cutout of the creator). When
   *  provided, it's composited OVER the neon border so the subject
   *  "breaks out of the frame" — head/shoulders sit in front of the
   *  border line. Must match the base image dimensions exactly. */
  personCutoutPng?: Buffer
  /** Telemetry for the renderDesignerOverlay text step. */
  userId: string
  tier: string | null
}

export interface BakeResult {
  png: Buffer
  width: number
  height: number
  /** Set when a step failed and `png` is a fallback. */
  renderError?: string
}

/**
 * Bake the headline + border + cutout onto the base. Never throws —
 * surfaces failures via renderError so the caller can ship the base
 * if any step breaks.
 */
export async function bakeSimpleHeadline(
  baseImage: Buffer,
  copy: ThumbCopyForBake,
  opts: BakeOptions,
): Promise<BakeResult> {
  let width = opts.width ?? 1280
  let height = opts.height ?? 720
  try {
    const meta = await sharp(baseImage).metadata()
    if (meta.width && meta.height) { width = meta.width; height = meta.height }
  } catch { /* fall back to defaults */ }

  const scaleBase = Math.max(360, Math.min(width, height * 16 / 9))

  // ── 1. Neon border SVG (cyan→magenta gradient + blurred glow) ──────────
  const borderInset = Math.round(scaleBase * 0.028)
  const borderRadius = Math.round(scaleBase * 0.026)
  const borderSharpWidth = Math.round(scaleBase * 0.006)
  const borderGlowWidth = Math.round(scaleBase * 0.025)
  const borderSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="50%" stop-color="#FF00E5"/>
      <stop offset="100%" stop-color="#00E5FF"/>
    </linearGradient>
    <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${Math.round(scaleBase * 0.008)}"/>
    </filter>
  </defs>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderGlowWidth}"
        filter="url(#neonBlur)" opacity="0.75"/>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderSharpWidth}"/>
</svg>`

  try {
    // ── 2. Render the border (shapes only — Resvg handles these fine) ────
    const borderResvg = new Resvg(borderSvg, {
      fitTo: { mode: 'width', value: width },
      background: 'rgba(0,0,0,0)',
    })
    const borderPng = borderResvg.render().asPng()

    // ── 3. Render the text via Satori path (renderDesignerOverlay) ───────
    // The dual-color-stack template produces: line1 white, line2 in accent
    // (yellow) colour. We pass a TRANSPARENT base so the result is just
    // the text on transparent background, ready to composite as a layer.
    // forceContent skips the Satori path's internal Haiku decomposition,
    // so the rendered text is exactly our 4-angle ThumbCopy.
    const transparentBase = await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer()
    const transparentBaseDataUri = `data:image/png;base64,${transparentBase.toString('base64')}`

    // Subject side derives from anchor: text on upper-LEFT means subject
    // on the RIGHT and vice versa. renderDesignerOverlay reads subjectSide
    // to decide which half of the canvas holds the text column.
    const subjectSide: 'left' | 'right' = (opts.anchor ?? 'upper-left') === 'upper-left' ? 'right' : 'left'

    const overlayResult = await renderDesignerOverlay({
      baseImageUrl: transparentBaseDataUri,
      headline: `${copy.line1} ${copy.line2}`,         // unused — forceContent below wins
      forceTemplateId: 'dual-color-stack',
      forceContent: {
        leading: copy.line1,
        punch: copy.line2,
      },
      subjectSide,
      verticalAnchor: 'top',
      userId: opts.userId,
      tier: opts.tier,
    })
    const textPng = overlayResult.png

    // ── 4. Composite stack ────────────────────────────────────────────────
    //   base image → border → (optional) person cutout → text overlay
    const compositeLayers: sharp.OverlayOptions[] = [
      { input: borderPng, top: 0, left: 0 },
    ]
    if (opts.personCutoutPng) {
      compositeLayers.push({ input: opts.personCutoutPng, top: 0, left: 0 })
    }
    compositeLayers.push({ input: textPng, top: 0, left: 0 })

    const final = await sharp(baseImage)
      .composite(compositeLayers)
      .jpeg({ quality: 92 })
      .toBuffer()

    return { png: final, width, height, renderError: undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[simple-bake] composite failed, returning bare base:', message)
    try {
      const bare = await sharp(baseImage).jpeg({ quality: 92 }).toBuffer()
      return { png: bare, width, height, renderError: message }
    } catch {
      return { png: baseImage, width, height, renderError: message }
    }
  }
}
