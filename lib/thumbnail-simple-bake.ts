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
function lineToPaths(font: Font, line: string, emphasis: string, fontSize: number, startX: number, baselineY: number, anchor: 'start' | 'end'): { paths: string; totalWidth: number } {
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
    const fill = seg.isEmphasis ? '#FFE034' : '#FFFFFF'
    pathsOut += `<path d="${d}" fill="${fill}"/>`
    pen += segWidths[i]
  }
  return { paths: pathsOut, totalWidth }
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

  // ── 1. Neon border SVG ──────────────────────────────────────────────────
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
    // shrink to fit colMaxWidth. floor at 60% of ceiling so a 50-char line
    // doesn't render microscopic — at that point the headline is too long
    // for the format and should be regenerated.
    const ceilLine1 = Math.round(scaleBase * 0.115)
    const ceilLine2 = Math.round(scaleBase * 0.095)
    const fontSizeLine1 = fitFontToWidth(font, copy.line1, ceilLine1, colMaxWidth, Math.round(ceilLine1 * 0.6))
    const fontSizeLine2 = fitFontToWidth(font, copy.line2, ceilLine2, colMaxWidth, Math.round(ceilLine2 * 0.6))
    const baselineLine1 = Math.round(height * 0.22)
    const baselineLine2 = baselineLine1 + Math.round(fontSizeLine2 * 1.05)
    const line1 = lineToPaths(font, copy.line1, copy.emphasisWord, fontSizeLine1, startX, baselineLine1, svgAnchor)
    const line2 = lineToPaths(font, copy.line2, copy.emphasisWord, fontSizeLine2, startX, baselineLine2, svgAnchor)

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
