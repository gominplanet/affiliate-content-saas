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

  // ── Neon glow border frame (2026-06-08, per user pick) ──────────────────
  // Cyan→magenta→cyan gradient stroke around the canvas perimeter with a
  // wider blurred copy underneath for the actual "neon glow" effect. Matches
  // the look in Gemini's "FINALLY RELAXING! / (Goodbye Stress)" reference.
  // The border sits 3% in from the canvas edges with rounded 28px corners.
  // Renders BEFORE the text so the headline sits cleanly on top of it.
  const borderInset = Math.round(scaleBase * 0.028)
  const borderRadius = Math.round(scaleBase * 0.026)
  const borderSharpWidth = Math.round(scaleBase * 0.006)
  const borderGlowWidth = Math.round(scaleBase * 0.025)

  // ── Diamond sparkle decoration (bottom-right corner) ────────────────────
  // Small 4-pointed star, white with subtle glow, anchored ~6% from the
  // bottom-right corner. Cheap polish — adds the "designed" feel Gemini's
  // reference has without competing with the headline or product.
  const sparkleSize = Math.round(scaleBase * 0.028)
  const sparkleCx = width - Math.round(width * 0.06)
  const sparkleCy = height - Math.round(height * 0.085)
  // 4-point star path centred on (0,0), drawn at sparkleSize. Points along
  // the cardinal axes with concave curves between to give it the "diamond
  // sparkle" silhouette rather than a sharp diamond.
  const s = sparkleSize
  const sQ = Math.round(s * 0.18)  // control-point distance for the curves
  const sparklePath = `M 0 -${s} Q ${sQ} -${sQ} ${s} 0 Q ${sQ} ${sQ} 0 ${s} Q -${sQ} ${sQ} -${s} 0 Q -${sQ} -${sQ} 0 -${s} Z`

  // The actual SVG. Key properties for Gemini-quality text:
  //   - paint-order: stroke fill         → outline behind glyph, full letter weight
  //   - stroke-linejoin: round           → smooth corners on bold serif terminals
  //   - stroke-linecap: round            → smooth at letter ends
  //   - font-family: 'BakeDisplay'       → matches the @font-face we resolve from
  //                                        the Anton font buffer at render time
  //   - transform: rotate(-3 ...)        → viral slant Gemini called out
  //   - drop-shadow filter               → lifts the text off the background so
  //                                        it pops on any base image
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(scaleBase * 0.008)}" stdDeviation="${Math.round(scaleBase * 0.004)}" flood-color="#000" flood-opacity="0.6"/>
    </filter>
    <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="50%" stop-color="#FF00E5"/>
      <stop offset="100%" stop-color="#00E5FF"/>
    </linearGradient>
    <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${Math.round(scaleBase * 0.008)}"/>
    </filter>
    <filter id="sparkleGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${Math.round(scaleBase * 0.004)}"/>
    </filter>
  </defs>
  <!-- Neon border: blurred glow underneath + sharp gradient stroke on top -->
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderGlowWidth}"
        filter="url(#neonBlur)" opacity="0.75"/>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderSharpWidth}"/>
  <!-- Diamond sparkle in the bottom-right corner -->
  <g transform="translate(${sparkleCx}, ${sparkleCy})">
    <path d="${sparklePath}" fill="#FFFFFF" filter="url(#sparkleGlow)" opacity="0.7"/>
    <path d="${sparklePath}" fill="#FFFFFF"/>
  </g>
  <style>
    .h {
      font-family: 'BakeDisplay';
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
    // takes file paths via `fontFiles`; the CSS font-family 'BakeDisplay'
    // inside the SVG matches the defaultFontFamily we configure here.
    const antonPath = resolveAntonPath()
    if (!antonPath) throw new Error('Anton font path could not be resolved')

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: {
        fontFiles: [antonPath],
        defaultFontFamily: 'BakeDisplay',
        loadSystemFonts: false, // explicit — we ONLY want Anton, no system fallback
      },
      background: 'rgba(0,0,0,0)',
    })
    const overlayPng = resvg.render().asPng()

    // Composite the Resvg-rendered text overlay onto the base image.
    const final = await sharp(baseImage)
      .composite([{ input: overlayPng, top: 0, left: 0 }])
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
