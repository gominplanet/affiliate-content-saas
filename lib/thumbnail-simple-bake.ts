// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// bakeSimpleHeadline — Gemini-spec thumbnail composite with razor-sharp
// typography. Uses opentype.js to convert text characters to SVG <path>
// elements at build time, then Resvg renders those paths with TRUE
// paint-order: stroke fill (no font matching, no WOFF parsing, no
// silent failures). Same approach Gemini's handoff described — vector
// paths + paint-order = crisp outlines that read pro at any scale.
//
// Why text-to-path (and not Resvg <text> + fontFiles):
//   - Resvg's text rendering with custom .woff files is unreliable in
//     serverless: silent failures when family name doesn't match, no
//     errors, just empty PNGs. We hit this three times.
//   - opentype.js loads the .woff/.ttf, parses glyph data, and exposes
//     getPath(text, x, y, size) → an SVG <path> with EXACT character
//     shapes. Resvg never has to do font work.
//   - paint-order: stroke fill applied to <path> = a true vector
//     stroke around each glyph, sharp at any resolution. The Gemini
//     "razor crispness" we couldn't get with text-shadow tricks.
//
// Why opentype.js loads the font ONCE and we cache the parsed font in
// module scope: parsing takes ~50ms cold; cached lookups are ~0ms.
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
// opentype.js is a CommonJS module. Next.js's serverless bundler wraps CJS
// modules differently across runtimes — sometimes the default import works
// (`import opentype from 'opentype.js'` → opentype.parse is callable),
// sometimes it doesn't (opentype is undefined and we get
// "Cannot read properties of undefined (reading 'parse')" at runtime).
// Using namespace import + a runtime defaulting layer covers BOTH shapes:
//   - ESM-style:  ns.parse is the function
//   - CJS-wrapped: ns.default.parse is the function (via __esModule)
import * as opentypeNs from 'opentype.js'
import type { Font, Path as OpentypePath } from 'opentype.js'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderDesignerOverlay } from '@/lib/thumbnail-text-templates'

// Resolve opentype.parse across both module shapes. Memoised so the
// interop check runs once per cold start.
let _opentypeParse: ((buf: ArrayBuffer) => Font) | null = null
function getOpentypeParse(): (buf: ArrayBuffer) => Font {
  if (_opentypeParse) return _opentypeParse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ns = opentypeNs as any
  if (typeof ns.parse === 'function') { _opentypeParse = ns.parse.bind(ns); return _opentypeParse! }
  if (ns.default && typeof ns.default.parse === 'function') {
    _opentypeParse = ns.default.parse.bind(ns.default)
    return _opentypeParse!
  }
  throw new Error('opentype.js loaded but neither .parse nor .default.parse is a function — module shape: ' + Object.keys(ns).join(','))
}

// Anton TTF lives at /lib/fonts/Anton-Regular.ttf in the repo. We use TTF
// (not the @fontsource WOFF) because opentype.js's WOFF support requires
// inflate decompression which is unreliable in Vercel's serverless runtime
// — it silently returns an unparseable font, font.getPath() yields empty
// paths, and the bake produces a blank text layer. TTF is opentype.js's
// native format and works deterministically.
//
// The .ttf is committed to the repo so Vercel's static-file bundler always
// ships it with the function (no path resolution surprises). Same lookup
// strategy as fonts.ts (process.cwd() base + walk up one directory for
// workspace hoisting).
let cachedFont: Font | null = null

function loadAntonFont(): Font {
  if (cachedFont) return cachedFont
  // /public/fonts/ is ALWAYS bundled with Next.js (static assets get auto-
  // copied to the function output without needing outputFileTracingIncludes).
  // /lib/fonts/ is a fallback for local dev or other bundlers.
  const candidates = [
    path.join(process.cwd(), 'public', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), 'lib', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), '..', 'public', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), '..', 'lib', 'fonts', 'Anton-Regular.ttf'),
  ]
  const parse = getOpentypeParse()
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const buffer = readFileSync(p)
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    cachedFont = parse(ab as ArrayBuffer)
    console.log('[simple-bake] Anton TTF loaded from', p, '— numGlyphs:', cachedFont.glyphs.length)
    return cachedFont
  }
  throw new Error(`Anton TTF not found. Tried: ${candidates.join(' OR ')}`)
}

export interface ThumbCopyForBake {
  line1: string
  line2: string
  emphasisWord: string
}

export interface BakeOptions {
  width?: number
  height?: number
  /** Which neon-border style to use (color + shape). Pass the variant index so
   *  each thumbnail in a batch gets a DIFFERENT border; omit for a random pick.
   *  See NEON_BORDER_STYLES. */
  borderStyleIndex?: number
  /** Title emphasis-word colour (hex). The emphasis word renders in this colour;
   *  the rest of the headline stays white. Default '#FFE034' (yellow). Set from a
   *  creator's saved brand style. */
  accentColor?: string
  anchor?: 'upper-left' | 'upper-right'
  personCutoutPng?: Buffer
  /** For the Satori-based text fallback (renderDesignerOverlay) when
   *  opentype.js fails. Optional but recommended — without it the
   *  fallback's telemetry won't link to a user. */
  userId?: string
  tier?: string | null
}

export interface BakeResult {
  png: Buffer
  width: number
  height: number
  renderError?: string
  /** Which text renderer actually produced the output. Surfaced in the
   *  API response so we can see from the browser which path ran without
   *  Vercel function logs. */
  bakePath?: 'opentype' | 'satori' | 'none'
  /** Diagnostic explaining why opentype didn't run (path missing, parse
   *  failure, empty PNG output, etc.). Surfaced in API response. */
  opentypeError?: string
}

/**
 * Find the largest fontSize where `text` renders within `maxWidth` using
 * the supplied font. Uses opentype's own advance-width metrics (the same
 * ones lineToPaths uses to position glyphs), so the fit is EXACT — no
 * glyphRatio estimate, no off-by-13%-overflow.
 *
 * Returns the ceiling when it already fits; otherwise scales linearly
 * from ceiling × (maxWidth / actualWidth). Linear scaling works because
 * font advance widths are linear in size at a fixed family/weight.
 *
 * Floor (`minSize`) prevents pathological inputs (50-char headlines) from
 * shrinking to unreadable — caller can decide to regenerate copy or accept
 * mild overflow at the floor.
 */
function fitFontToWidth(font: Font, text: string, ceilSize: number, maxWidth: number, minSize: number): number {
  if (!text || maxWidth <= 0) return ceilSize
  const widthAtCeil = font.getAdvanceWidth(text.toUpperCase(), ceilSize)
  if (widthAtCeil <= maxWidth) return ceilSize
  const scaled = Math.floor(ceilSize * (maxWidth / widthAtCeil))
  return Math.max(minSize, scaled)
}

/**
 * Convert a single line of text into an array of {pathData, isEmphasis}
 * chunks, anchored at (x, y). Each chunk corresponds to a run of text
 * that needs one colour — runs containing the emphasis word are flagged
 * isEmphasis=true so the SVG renders them yellow.
 *
 * Returns the SVG <path> snippets ready to splice into the parent SVG,
 * plus the total advance width so the caller can centre/right-align.
 */
function lineToPaths(font: Font, line: string, emphasis: string, fontSize: number, startX: number, baselineY: number, anchor: 'start' | 'end', accentColor: string): { paths: string; totalWidth: number } {
  const upper = line.toUpperCase()
  const upperEmphasis = emphasis.toUpperCase().trim()

  // Build a [text, isEmphasis] segment list by splitting the line at
  // the first whole-word match of the emphasis. If the emphasis word
  // isn't in the line, the whole line is one non-emphasis segment.
  const segments: Array<{ text: string; isEmphasis: boolean }> = []
  if (upperEmphasis && upper.includes(upperEmphasis)) {
    const idx = upper.indexOf(upperEmphasis)
    if (idx > 0) segments.push({ text: upper.slice(0, idx), isEmphasis: false })
    segments.push({ text: upperEmphasis, isEmphasis: true })
    const tail = upper.slice(idx + upperEmphasis.length)
    if (tail) segments.push({ text: tail, isEmphasis: false })
  } else {
    segments.push({ text: upper, isEmphasis: false })
  }

  // First pass: measure each segment's advance width so we can position
  // them precisely on the baseline.
  const segWidths = segments.map(s => font.getAdvanceWidth(s.text, fontSize))
  const totalWidth = segWidths.reduce((a, b) => a + b, 0)

  // If anchor='end' the line ends at startX (right-aligned); shift the
  // origin LEFT by totalWidth.
  let pen = anchor === 'end' ? startX - totalWidth : startX
  let pathsOut = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const p: OpentypePath = font.getPath(seg.text, pen, baselineY, fontSize)
    const d = p.toPathData(2)
    // Each glyph chunk is one <path>. The fill colour is the only
    // difference between emphasis and non-emphasis runs; stroke +
    // paint-order are inherited from the <g> wrapper for consistency.
    const fill = seg.isEmphasis ? accentColor : '#FFFFFF'
    pathsOut += `<path d="${d}" fill="${fill}"/>`
    pen += segWidths[i]
  }
  return { paths: pathsOut, totalWidth }
}

// ── Neon border styles ──────────────────────────────────────────────────────
// The glowing frame around the thumbnail. 10 variants (color + shape) so a batch
// of thumbnails — and successive generations — don't all wear the same border.
// The route passes the per-variant index (BakeOptions.borderStyleIndex) so each
// variant in one batch is distinct; falls back to a random pick when no index.
interface NeonBorderStyle {
  stops: [string, string, string]
  angle: 'diagonal' | 'vertical' | 'horizontal'
  radiusMul: number  // corner radius ÷ scaleBase — small = sharp, large = pill
  glowMul: number    // outer glow stroke width ÷ scaleBase
  opacity: number    // glow-layer opacity
}
const NEON_BORDER_STYLES: NeonBorderStyle[] = [
  { stops: ['#00E5FF', '#FF00E5', '#00E5FF'], angle: 'diagonal',   radiusMul: 0.026, glowMul: 0.025, opacity: 0.75 }, // cyan ↔ magenta (original)
  { stops: ['#FFE600', '#FFB400', '#FFE600'], angle: 'diagonal',   radiusMul: 0.020, glowMul: 0.028, opacity: 0.82 }, // all-yellow / amber
  { stops: ['#39FF14', '#00FFA3', '#39FF14'], angle: 'vertical',   radiusMul: 0.030, glowMul: 0.024, opacity: 0.78 }, // neon green ↔ teal
  { stops: ['#FF2D95', '#A020F0', '#FF2D95'], angle: 'diagonal',   radiusMul: 0.018, glowMul: 0.026, opacity: 0.80 }, // hot pink ↔ purple
  { stops: ['#FF8A00', '#FF1E1E', '#FF8A00'], angle: 'horizontal', radiusMul: 0.024, glowMul: 0.030, opacity: 0.80 }, // fire (orange ↔ red), wide glow
  { stops: ['#FFFFFF', '#33B5FF', '#FFFFFF'], angle: 'diagonal',   radiusMul: 0.034, glowMul: 0.022, opacity: 0.72 }, // ice (white ↔ blue), very rounded
  { stops: ['#FFD700', '#FF9D00', '#FFD700'], angle: 'vertical',   radiusMul: 0.022, glowMul: 0.026, opacity: 0.82 }, // gold
  { stops: ['#B6FF00', '#00E5FF', '#B6FF00'], angle: 'diagonal',   radiusMul: 0.028, glowMul: 0.025, opacity: 0.78 }, // lime ↔ cyan
  { stops: ['#FF00E5', '#00E5FF', '#FFE600'], angle: 'diagonal',   radiusMul: 0.020, glowMul: 0.027, opacity: 0.80 }, // tri-color rainbow
  { stops: ['#00E5FF', '#0091FF', '#00E5FF'], angle: 'diagonal',   radiusMul: 0.008, glowMul: 0.018, opacity: 0.85 }, // electric blue, SHARP corners + tight glow
]
/** Count of neon border styles — exported so the route's random offset and a
 *  saved brand-style index stay in range without duplicating the magic number. */
export const NEON_BORDER_STYLE_COUNT = NEON_BORDER_STYLES.length

function neonGradientCoords(angle: NeonBorderStyle['angle']): string {
  if (angle === 'vertical') return 'x1="0%" y1="0%" x2="0%" y2="100%"'
  if (angle === 'horizontal') return 'x1="0%" y1="0%" x2="100%" y2="0%"'
  return 'x1="0%" y1="0%" x2="100%" y2="100%"'
}
function pickNeonBorderStyle(index?: number): NeonBorderStyle {
  const i = typeof index === 'number' && index >= 0
    ? index % NEON_BORDER_STYLES.length
    : Math.floor(Math.random() * NEON_BORDER_STYLES.length)
  return NEON_BORDER_STYLES[i]
}

export async function bakeSimpleHeadline(
  baseImage: Buffer,
  copy: ThumbCopyForBake,
  opts: BakeOptions = {},
): Promise<BakeResult> {
  let width = opts.width ?? 1280
  let height = opts.height ?? 720
  try {
    const meta = await sharp(baseImage).metadata()
    if (meta.width && meta.height) { width = meta.width; height = meta.height }
  } catch { /* fall back to defaults */ }

  const scaleBase = Math.max(360, Math.min(width, height * 16 / 9))

  // ── 1. Neon border SVG (randomized color + shape per variant) ────────────
  const nStyle = pickNeonBorderStyle(opts.borderStyleIndex)
  const borderInset = Math.round(scaleBase * 0.028)
  const borderRadius = Math.round(scaleBase * nStyle.radiusMul)
  const borderSharpWidth = Math.round(scaleBase * 0.006)
  const borderGlowWidth = Math.round(scaleBase * nStyle.glowMul)
  const borderSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="neon" ${neonGradientCoords(nStyle.angle)}>
      <stop offset="0%" stop-color="${nStyle.stops[0]}"/>
      <stop offset="50%" stop-color="${nStyle.stops[1]}"/>
      <stop offset="100%" stop-color="${nStyle.stops[2]}"/>
    </linearGradient>
    <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="${Math.round(scaleBase * 0.008)}"/>
    </filter>
  </defs>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderGlowWidth}"
        filter="url(#neonBlur)" opacity="${nStyle.opacity}"/>
  <rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}"
        rx="${borderRadius}" ry="${borderRadius}"
        fill="none" stroke="url(#neon)" stroke-width="${borderSharpWidth}"/>
</svg>`

  // ── 2. Headline text as opentype-rendered SVG paths ─────────────────────
  // Position the headline column. Anchor 'upper-left' = text aligns to
  // canvas-left side; 'upper-right' mirrors.
  //
  // 2026-06-08 REGRESSION FIX: previously the opentype path had NO width
  // constraint — fontSizeLine1/2 were fixed at 11.5%/9.5% of scaleBase and
  // glyphs just extended freely from startX. For a long headline like
  // "BUY SINGLE GIFTS AGAIN" the text rendered ~1500px wide on a 1280px
  // canvas, overflowed the right edge, AND covered the subject area on
  // the same side as startX. The Satori fallback path handled this via
  // column-based flex layout, but the opentype primary path didn't.
  //
  // Fix: cap each line's actual rendered width to colMaxWidth (55% of
  // canvas, matching the Satori dual-color-stack column). Use opentype's
  // own font.getAdvanceWidth() to MEASURE the line at the desired size,
  // then proportionally scale fontSize down if it exceeds colMaxWidth.
  // Result: long headlines auto-fit; short headlines stay big.
  const strokeWidth = Math.round(scaleBase * 0.018)
  const anchor = opts.anchor ?? 'upper-left'
  const padX = Math.round(width * 0.062)
  const startX = anchor === 'upper-left' ? padX : width - padX
  const svgAnchor: 'start' | 'end' = anchor === 'upper-left' ? 'start' : 'end'
  // The column the text MUST fit inside, matching the Satori template's 55%
  // column. Leaves the opposite ~45% of the canvas clear for the subject
  // (face or product) so text can never bleed into it.
  const colMaxWidth = Math.round(width * 0.55) - padX

  let textSvg: string | null = null
  let opentypeErrorMessage: string | undefined
  try {
    const font = loadAntonFont()

    // Auto-fit each line individually: start at the ceiling size, measure,
    // shrink to fit colMaxWidth.
    //
    // 2026-06-08: previous floor was 60% of ceiling (88px on a 1280 canvas).
    // For a 17-char headline like "NEVER CHEAP AGAIN" the math needed ~57px
    // to fit the 55% column — but the 88px floor clamped it and the text
    // overflowed the canvas. Dropped the floor to an ABSOLUTE 50px which is
    // still readable on a YouTube thumbnail mobile feed and lets headlines
    // up to ~20 chars (line1) / ~25 chars (line2) fit cleanly. Beyond that,
    // the copy generator should produce shorter copy, not floor the size.
    const MIN_FONT_PX = 50
    const ceilLine1 = Math.round(scaleBase * 0.115)
    const ceilLine2 = Math.round(scaleBase * 0.095)
    const fontSizeLine1 = fitFontToWidth(font, copy.line1, ceilLine1, colMaxWidth, MIN_FONT_PX)
    const fontSizeLine2 = fitFontToWidth(font, copy.line2, ceilLine2, colMaxWidth, MIN_FONT_PX)
    const baselineLine1 = Math.round(height * 0.22)
    const baselineLine2 = baselineLine1 + Math.round(fontSizeLine2 * 1.05)
    // Emphasis-word colour: the creator's saved brand accent, else default yellow.
    const accentColor = opts.accentColor || '#FFE034'
    const line1 = lineToPaths(font, copy.line1, copy.emphasisWord, fontSizeLine1, startX, baselineLine1, svgAnchor, accentColor)
    const line2 = lineToPaths(font, copy.line2, copy.emphasisWord, fontSizeLine2, startX, baselineLine2, svgAnchor, accentColor)

    // Post-fit sanity check: when the MIN_FONT_PX floor clamps a long line,
    // overflow can sneak through silently. Re-measure the actual rendered
    // width and surface it as opentypeError so the API response shows that
    // the headline is too long for the column. Doesn't fail the bake (text
    // still renders, just clipped at the canvas edge) — but the user gets
    // signal they need shorter copy.
    if (line1.totalWidth > colMaxWidth + 4) {
      const overshoot = Math.round(line1.totalWidth - colMaxWidth)
      opentypeErrorMessage = `Line 1 overflows column by ${overshoot}px at ${fontSizeLine1}px floor. Shorten "${copy.line1}" (${copy.line1.length} chars).`
      console.warn('[simple-bake]', opentypeErrorMessage)
    } else if (line2.totalWidth > colMaxWidth + 4) {
      const overshoot = Math.round(line2.totalWidth - colMaxWidth)
      opentypeErrorMessage = `Line 2 overflows column by ${overshoot}px at ${fontSizeLine2}px floor. Shorten "${copy.line2}" (${copy.line2.length} chars).`
      console.warn('[simple-bake]', opentypeErrorMessage)
    }

    // Wrap both lines in a <g> with the rotation + stroke + paint-order.
    // Setting stroke/paint-order on the group means every child <path>
    // inherits the SAME outline treatment without us having to repeat
    // it on each one.
    //
    // The rotation pivot uses startX + baselineLine1 — the visual top-left
    // of the headline column. For right-anchored we pivot at startX (the
    // right edge of the column).
    textSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(scaleBase * 0.008)}" stdDeviation="${Math.round(scaleBase * 0.004)}" flood-color="#000" flood-opacity="0.65"/>
    </filter>
  </defs>
  <g transform="rotate(-3, ${startX}, ${baselineLine1})"
     stroke="#000000"
     stroke-width="${strokeWidth}"
     stroke-linejoin="round"
     stroke-linecap="round"
     paint-order="stroke fill"
     filter="url(#ds)">
    ${line1.paths}
    ${line2.paths}
  </g>
</svg>`
  } catch (err) {
    opentypeErrorMessage = err instanceof Error ? err.message : String(err)
    console.warn('[simple-bake] opentype text render failed:', opentypeErrorMessage)
  }

  try {
    const borderResvg = new Resvg(borderSvg, {
      fitTo: { mode: 'width', value: width },
      background: 'rgba(0,0,0,0)',
    })
    const borderPng = borderResvg.render().asPng()

    // ── Text rendering with two-stage fallback ──────────────────────────
    let textPng: Buffer | null = null
    let bakePath: 'opentype' | 'satori' | 'none' = 'none'
    if (textSvg) {
      try {
        const textResvg = new Resvg(textSvg, {
          fitTo: { mode: 'width', value: width },
          background: 'rgba(0,0,0,0)',
        })
        textPng = textResvg.render().asPng()
        if (textPng.byteLength < 2000) {
          opentypeErrorMessage = `Resvg output too small (${textPng.byteLength}B) — silent font failure`
          console.warn('[simple-bake]', opentypeErrorMessage)
          textPng = null
        } else {
          bakePath = 'opentype'
          console.log('[simple-bake] opentype text rendered ok:', textPng.byteLength, 'bytes')
        }
      } catch (err) {
        opentypeErrorMessage = `Resvg render exception: ${err instanceof Error ? err.message : String(err)}`
        console.warn('[simple-bake] opentype Resvg render failed:', opentypeErrorMessage)
        textPng = null
      }
    }

    if (!textPng) {
      try {
        console.log('[simple-bake] falling back to Satori text rendering. opentype reason:', opentypeErrorMessage ?? 'unknown')
        const transparentBase = await sharp({
          create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).png().toBuffer()
        const transparentBaseDataUri = `data:image/png;base64,${transparentBase.toString('base64')}`
        const subjectSide: 'left' | 'right' = (opts.anchor ?? 'upper-left') === 'upper-left' ? 'right' : 'left'

        const overlayResult = await renderDesignerOverlay({
          baseImageUrl: transparentBaseDataUri,
          headline: `${copy.line1} ${copy.line2}`,
          forceTemplateId: 'dual-color-stack',
          forceContent: { leading: copy.line1, punch: copy.line2 },
          subjectSide,
          verticalAnchor: 'top',
          userId: opts.userId ?? '',
          tier: opts.tier ?? null,
        })
        textPng = overlayResult.png
        bakePath = 'satori'
      } catch (err) {
        console.warn('[simple-bake] Satori fallback ALSO failed:', err instanceof Error ? err.message : String(err))
      }
    }

    const compositeLayers: sharp.OverlayOptions[] = [
      { input: borderPng, top: 0, left: 0 },
    ]
    if (opts.personCutoutPng) {
      compositeLayers.push({ input: opts.personCutoutPng, top: 0, left: 0 })
    }
    if (textPng) {
      compositeLayers.push({ input: textPng, top: 0, left: 0 })
    }

    const final = await sharp(baseImage)
      .composite(compositeLayers)
      .jpeg({ quality: 92 })
      .toBuffer()

    return { png: final, width, height, renderError: undefined, bakePath, opentypeError: opentypeErrorMessage }
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
