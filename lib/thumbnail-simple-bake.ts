// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// bakeSimpleHeadline — true vector text bake via Resvg, exactly per Gemini's
// handoff spec. Replaces the Satori-based dual-color-stack approach which
// uses 8-direction text-shadow tricks to fake an outline (produces soft
// blurry edges). Resvg + raw SVG with `paint-order: stroke fill` produces
// a SHARP vector stroke around each glyph — the "crisp" look that
// separates pro thumbnails from amateur ones.
//
// Why Resvg (not sharp + SVG):
//   - Sharp's SVG renderer (libvips/Pango) needs OS-level fontconfig
//     registration to find custom fonts — impossible on Vercel serverless.
//   - Resvg accepts font BUFFERS directly via the `font.fontFiles` /
//     `font.fontBuffers` option. We already load Anton this way for the
//     Satori path.
//
// Why paint-order: stroke fill:
//   - Standard rendering paints the fill first, then the stroke ON TOP,
//     which means a thick black stroke EATS INTO the letter shape —
//     letters look thinner and muddier.
//   - paint-order: stroke fill flips it: stroke renders BEHIND the fill,
//     so the letters keep their full thickness and the outline sits
//     cleanly OUTSIDE the glyph paths.
//   - This is the single biggest reason Gemini's text looks sharper than
//     ours.
//
// Inputs: base PNG/JPEG buffer + ThumbCopy from our 4-angle text engine.
// Output: composited buffer with crisp baked typography.
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Resvg's font option takes FILE PATHS (not buffers). Resolve the bundled
// Anton .woff path from node_modules — same lookup strategy the Satori
// designer-overlay path uses for its font Buffer reads. Cached after the
// first resolution since the path doesn't change at runtime.
const ANTON_REL = '@fontsource/anton/files/anton-latin-400-normal.woff'
let cachedAntonPath: string | null = null
function resolveAntonPath(): string | null {
  if (cachedAntonPath) return cachedAntonPath
  const candidates = [
    path.join(process.cwd(), 'node_modules', ANTON_REL),
    path.join(process.cwd(), '..', 'node_modules', ANTON_REL),
  ]
  for (const p of candidates) {
    if (existsSync(p)) { cachedAntonPath = p; return p }
  }
  console.warn('[simple-bake] Anton font path not found. Tried:', candidates.join(' AND '))
  return null
}

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
}

export interface BakeResult {
  png: Buffer
  width: number
  height: number
  /** Set when the bake step failed and `png` is the un-textified base. */
  renderError?: string
}

/** XML-escape so user copy can't break the SVG markup. */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Inject a <tspan fill="#FFE034">…</tspan> around the emphasis word inside
 * a line so it renders yellow while the rest stays white. Case-insensitive,
 * word-bounded, first match only. Returns the original (escaped) line if
 * the emphasis word isn't present.
 */
function colorizeEmphasis(line: string, emphasis: string): string {
  const safeLine = escapeXml(line)
  const safeEmphasis = escapeXml(emphasis.trim())
  if (!safeEmphasis) return safeLine
  const escaped = safeEmphasis.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b(${escaped})\\b`, 'i')
  if (!re.test(safeLine)) return safeLine
  return safeLine.replace(re, '<tspan fill="#FFE034">$1</tspan>')
}

/**
 * Bake the headline onto the base image with razor-sharp Resvg-rendered
 * typography. Never throws — surfaces failures via renderError so the
 * caller can ship the bare base on bake failure.
 */
export async function bakeSimpleHeadline(
  baseImage: Buffer,
  copy: ThumbCopyForBake,
  opts: BakeOptions = {},
): Promise<BakeResult> {
  // Resolve the canvas size from the base image first — typography scales
  // off the smaller dimension so it looks consistent on 1280×720 or any
  // other aspect we might generate at.
  let width = opts.width ?? 1280
  let height = opts.height ?? 720
  try {
    const meta = await sharp(baseImage).metadata()
    if (meta.width && meta.height) { width = meta.width; height = meta.height }
  } catch { /* fall back to defaults */ }

  // Build the colourised lines first — yellow tspan wrapping the emphasis
  // word, white default fill on the rest of the line.
  const line1 = colorizeEmphasis(copy.line1.toUpperCase(), copy.emphasisWord)
  const line2 = colorizeEmphasis(copy.line2.toUpperCase(), copy.emphasisWord)

  // Type sizing. Gemini's reference: line1 ~85px, line2 ~70px at 1280×720.
  // Scale base picks the smaller of (width, height*16/9) so we don't blow
  // up on tall crops. Floor at 360 so small thumbs still render legibly.
  const scaleBase = Math.max(360, Math.min(width, height * 16 / 9))
  const fontSizeLine1 = Math.round(scaleBase * 0.118)
  const fontSizeLine2 = Math.round(scaleBase * 0.098)

  // The stroke width is the magic number that controls outline thickness.
  // Gemini's spec calls for 14px at 1280×720 = ~1.1% of canvas width.
  // We honour that ratio scaled to our render size.
  const strokeWidth = Math.round(scaleBase * 0.0195)

  // Anchor — text goes in the upper corner opposite the product.
  const anchor = opts.anchor ?? 'upper-left'
  const padX = Math.round(width * 0.062)
  const x = anchor === 'upper-left' ? padX : width - padX
  const yLine1 = Math.round(height * 0.21)
  const yLine2 = yLine1 + fontSizeLine2 + Math.round(scaleBase * 0.022)
  const textAnchor = anchor === 'upper-left' ? 'start' : 'end'

  // ── Neon glow border frame ──────────────────────────────────────────────
  // Cyan→magenta gradient stroke around the canvas perimeter with a wider
  // blurred copy underneath for the actual "neon glow" effect. The border
  // is rendered as its own SVG so it can be composited UNDER the rembg
  // person cutout — the creator's head/shoulders then sit IN FRONT of the
  // border, "breaking out of the frame" exactly like Gemini's reference.
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

  // ── Headline SVG (separate from the border so the cutout can layer between
  //    them). Critical for text rendering: font-family is 'Anton' — that's
  //    the actual family name embedded in the @fontsource/anton .woff file.
  //    Earlier versions used 'BakeDisplay' which resolved to NOTHING and
  //    silently fell back to system fonts (none exist in Vercel) → text
  //    disappeared entirely. Lesson learnt: font-family in CSS must match
  //    the name baked into the font file, not an alias.
  const textSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(scaleBase * 0.008)}" stdDeviation="${Math.round(scaleBase * 0.004)}" flood-color="#000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <style>
    .h {
      font-family: 'Anton';
      font-weight: 400;
      fill: #FFFFFF;
      stroke: #000000;
      stroke-width: ${strokeWidth}px;
      stroke-linejoin: round;
      stroke-linecap: round;
      paint-order: stroke fill;
      letter-spacing: -1px;
    }
  </style>
  <g transform="rotate(-3, ${x}, ${yLine1})" filter="url(#ds)">
    <text x="${x}" y="${yLine1}" class="h" font-size="${fontSizeLine1}" text-anchor="${textAnchor}">${line1}</text>
    <text x="${x}" y="${yLine2}" class="h" font-size="${fontSizeLine2}" text-anchor="${textAnchor}">${line2}</text>
  </g>
</svg>`

  try {
    // Resolve Anton's filesystem path from node_modules. Resvg's font option
    // takes file paths via `fontFiles`. font-family in the SVG CSS must
    // EXACTLY match the family name embedded in the .woff file — the
    // @fontsource/anton package exports the family as 'Anton'. Using any
    // other name (we previously had 'BakeDisplay') silently breaks text
    // rendering because Resvg can't find a match.
    const antonPath = resolveAntonPath()
    if (!antonPath) throw new Error('Anton font path could not be resolved')

    // Render the BORDER pass first — no font needed, just shapes. We
    // composite it BEFORE the person cutout so the creator sits in front.
    const borderResvg = new Resvg(borderSvg, {
      fitTo: { mode: 'width', value: width },
      background: 'rgba(0,0,0,0)',
    })
    const borderPng = borderResvg.render().asPng()

    // Render the TEXT pass second. Anton is loaded explicitly; system
    // fonts are disabled so we get a clean error (not tofu boxes) if the
    // .woff fails to load.
    const textResvg = new Resvg(textSvg, {
      fitTo: { mode: 'width', value: width },
      font: {
        fontFiles: [antonPath],
        defaultFontFamily: 'Anton',
        loadSystemFonts: false,
      },
      background: 'rgba(0,0,0,0)',
    })
    const textPng = textResvg.render().asPng()

    // Build the composite stack:
    //   1. base image                                  — the NB Pro scene
    //   2. neon border SVG                             — drawn ON the base
    //   3. (optional) person cutout PNG                — overlays the border
    //      so the creator's head/shoulders appear in front of the border
    //      line — the "break out of the frame" Gemini look
    //   4. headline text SVG                           — always on top
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
    console.warn('[simple-bake] resvg bake failed, returning bare base:', message)
    try {
      const bare = await sharp(baseImage).jpeg({ quality: 92 }).toBuffer()
      return { png: bare, width, height, renderError: message }
    } catch {
      return { png: baseImage, width, height, renderError: message }
    }
  }
}
