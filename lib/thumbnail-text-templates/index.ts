// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Public entry point for the designer-grade text overlay system.
//
//   renderDesignerOverlay({ baseImageUrl, headline, ... })
//     → returns a finished PNG buffer with the picker-selected template
//       rendered over the base image at thumbnail resolution
//
// Stack:
//   1. picker      (Haiku)   → picks template + decomposes headline + palette
//   2. template    (function) → returns a Satori element tree
//   3. satori      (rust)    → element tree → SVG string with embedded glyphs
//   4. resvg       (rust)    → SVG → PNG buffer (1280×720 or whatever input dims)
//   5. sharp                 → composites the PNG over the base image
//
// All steps run server-side — no headless browser, no client canvas. The
// orchestrator is the only thing the rest of the codebase calls.

import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { pickTemplate } from './picker'
import { templateById } from './templates'
import { fontsFor } from './fonts'
import type { PickedTemplate, Side } from './types'

export interface RenderDesignerOverlayInput {
  /** URL or http(s) data URI of the base thumbnail (clean image, no text). */
  baseImageUrl: string
  /** The headline to render. Picker decomposes it. */
  headline: string
  /** Optional product/topic context — improves picker accuracy. */
  productContext?: string | null
  /** Which side the subject (face/product) occupies in the base image. Text
   *  is placed on the OTHER side. If not provided, defaults to 'right' so
   *  the text sits on the left (matches our most common layout). */
  subjectSide?: Side
  /** Optional override: skip the picker and use this template id directly.
   *  Useful for admin testing or when the caller has already chosen. */
  forceTemplateId?: string
  /** Override the headline decomposition. If provided, picker still chooses
   *  the template but uses this content instead of its own split. */
  forceContent?: PickedTemplate['content']
  /** Caller for usage tracking. */
  userId: string
  tier: string | null
  /** Output dimensions. Defaults to 1280×720 (16:9 YouTube). */
  width?: number
  height?: number
}

export interface RenderDesignerOverlayOutput {
  /** Final composited PNG bytes — base image + text overlay. */
  png: Buffer
  /** What the picker chose, returned for debugging/telemetry. */
  picked: PickedTemplate
  /** Pixel dimensions of the output. */
  width: number
  height: number
}

/**
 * Render the designer text overlay on top of a base thumbnail.
 *
 * Never throws on picker/Satori errors — falls back to the base image
 * unchanged if rendering fails, with a console.warn explaining why.
 * The caller can decide whether to ship the un-textified image or retry.
 */
export async function renderDesignerOverlay(input: RenderDesignerOverlayInput): Promise<RenderDesignerOverlayOutput> {
  const width = input.width ?? 1280
  const height = input.height ?? 720
  // Text goes on the OPPOSITE side of the subject.
  const textSide: Side = input.subjectSide === 'left' ? 'right' : 'left'

  // ── 1. Pick template + decompose headline + palette ──────────────────────
  const picked = input.forceTemplateId
    ? {
        templateId: input.forceTemplateId,
        content: input.forceContent ?? (await pickTemplate({
          headline: input.headline,
          productContext: input.productContext,
          baseImageUrl: input.baseImageUrl,
          userId: input.userId,
          tier: input.tier,
        })).content,
        palette: (await pickTemplate({
          headline: input.headline,
          productContext: input.productContext,
          baseImageUrl: input.baseImageUrl,
          userId: input.userId,
          tier: input.tier,
        })).palette,
      }
    : await pickTemplate({
        headline: input.headline,
        productContext: input.productContext,
        baseImageUrl: input.baseImageUrl,
        userId: input.userId,
        tier: input.tier,
      })

  const template = templateById(picked.templateId)
  if (!template) {
    console.warn('[designer-overlay] unknown templateId from picker, falling back to base image', picked.templateId)
    return { png: await fetchBaseAsPng(input.baseImageUrl, width, height), picked, width, height }
  }

  // ── 2. Render template → Satori element tree ─────────────────────────────
  const tree = template.render({ width, height, side: textSide, content: picked.content, palette: picked.palette })

  // ── 3. Satori → SVG ──────────────────────────────────────────────────────
  let svg: string
  try {
    svg = await satori(tree, {
      width,
      height,
      fonts: fontsFor(template.fonts),
    })
  } catch (e) {
    console.warn('[designer-overlay] satori failed, returning base image', e instanceof Error ? e.message : String(e))
    return { png: await fetchBaseAsPng(input.baseImageUrl, width, height), picked, width, height }
  }

  // ── 4. Resvg → PNG buffer of the overlay layer ───────────────────────────
  let overlayPng: Buffer
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: 'rgba(0,0,0,0)',
    })
    overlayPng = resvg.render().asPng()
  } catch (e) {
    console.warn('[designer-overlay] resvg rasterise failed, returning base image', e instanceof Error ? e.message : String(e))
    return { png: await fetchBaseAsPng(input.baseImageUrl, width, height), picked, width, height }
  }

  // ── 5. Composite overlay onto base via sharp ─────────────────────────────
  try {
    const basePng = await fetchBaseAsPng(input.baseImageUrl, width, height)
    const composited = await sharp(basePng)
      .composite([{ input: overlayPng, top: 0, left: 0 }])
      .png()
      .toBuffer()
    return { png: composited, picked, width, height }
  } catch (e) {
    console.warn('[designer-overlay] sharp composite failed, returning base image', e instanceof Error ? e.message : String(e))
    return { png: await fetchBaseAsPng(input.baseImageUrl, width, height), picked, width, height }
  }
}

/** Fetch the base image and normalise it to PNG at the requested dimensions. */
async function fetchBaseAsPng(url: string, width: number, height: number): Promise<Buffer> {
  let imgBuf: Buffer
  if (url.startsWith('data:')) {
    // data URI — split off the base64 payload directly
    const comma = url.indexOf(',')
    imgBuf = Buffer.from(url.slice(comma + 1), 'base64')
  } else {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    imgBuf = Buffer.from(await res.arrayBuffer())
  }
  return sharp(imgBuf).resize(width, height, { fit: 'cover' }).png().toBuffer()
}
