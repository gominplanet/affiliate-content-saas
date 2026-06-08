// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// bakeSimpleHeadline — programmatic SVG typography bake for thumbnails.
//
// Built from the user's Gemini handoff (2026-06-08) as the deliberate
// replacement for the failing NB Pro baked-text path. The reasoning:
//
//   Image generators (Nano Banana Pro, Flux, GPT-Image) are terrible at
//   typography. They misspell, drop letters, render wrong colors, get
//   sizes wrong. The correct architecture is to RENDER A TEXT-FREE BASE
//   (which they're great at) and bake the typography programmatically
//   with sharp + SVG (deterministic, pixel-perfect, every time).
//
// Inputs: a base PNG/JPEG buffer (the NB Pro text-free composition) plus
// a ThumbCopy from our 4-angle psychological text engine. Output: the
// same image with crisp Impact-style typography baked onto the upper-left
// at a -3° slant, white with the emphasis word in #FFE034 yellow.
//
// Why fixed layout (single template):
//   - Matches the Gemini reference 1:1 — the look they validated works.
//   - Deterministic. Same ThumbCopy + same base = same output every run.
//   - Zero AI calls (no Haiku decomposition, no template picker).
//   - Easy to debug — if text looks wrong, it's the ThumbCopy that's wrong.
//
// Why upper-left:
//   - Matches the Gemini reference layout (left-side text + right-side
//     product is the proven YouTube-thumbnail composition).
//   - The clean-path NB Pro prompt explicitly reserves the upper-LEFT
//     corner when the product is on the RIGHT (the most common variant).
//   - If a future variant puts the product on the left, we can mirror
//     this trivially — just swap x coordinates.
import sharp from 'sharp'

export interface ThumbCopyForBake {
  line1: string
  line2: string
  emphasisWord: string
}

export interface BakeOptions {
  /** Output dimensions. Defaults to the base image's intrinsic size, falling
   *  back to 1280×720 if the base has no metadata. */
  width?: number
  height?: number
  /** Which corner to anchor the text in. Defaults to 'upper-left' to match
   *  the Gemini reference. Switch to 'upper-right' when the variant put
   *  the product on the LEFT side of the frame. */
  anchor?: 'upper-left' | 'upper-right'
}

export interface BakeResult {
  /** Final composited image bytes (JPEG, quality 90). */
  png: Buffer
  /** Pixel dimensions of the output. */
  width: number
  height: number
  /** On bake failure, this is set and `png` is the un-textified base — the
   *  caller can decide whether to ship the bare image or retry. We
   *  intentionally never throw so the whole thumbnail-gen flow doesn't
   *  collapse if one composite fails (font missing, sharp hiccup, etc.). */
  renderError?: string
}

/** XML-escape ampersands and angle brackets so user copy can't break the
 *  SVG markup (e.g. "M&Ms" would otherwise blow up the parse). */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Inject a <tspan fill="#FFE034">...</tspan> around the emphasis word inside
 * a line so it renders yellow while the surrounding text stays white. The
 * match is case-insensitive and word-bounded — "ONE" matches "ONE" but
 * NOT "STONE" — and only the FIRST occurrence in the line is highlighted
 * (a second match would imply ambiguous emphasis).
 *
 * If the emphasis word isn't present in the line, the line is rendered as
 * plain (all-white) text — never throws.
 */
function colorizeEmphasis(line: string, emphasis: string): string {
  const safeLine = escapeXml(line)
  const safeEmphasis = escapeXml(emphasis.trim())
  if (!safeEmphasis) return safeLine
  // Word-bounded, case-insensitive, first match only.
  // We escape regex special chars in the emphasis (e.g. "$20" needs the $ escaped).
  const escaped = safeEmphasis.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b(${escaped})\\b`, 'i')
  if (!re.test(safeLine)) return safeLine
  return safeLine.replace(re, '<tspan fill="#FFE034">$1</tspan>')
}

/**
 * Bake the given ThumbCopy onto the base image. Returns the composited
 * buffer plus dimensions. Never throws — surfaces failures via renderError
 * so the caller can ship the bare base image if bake fails.
 */
export async function bakeSimpleHeadline(
  baseImage: Buffer,
  copy: ThumbCopyForBake,
  opts: BakeOptions = {},
): Promise<BakeResult> {
  const base = sharp(baseImage)
  let width = opts.width ?? 1280
  let height = opts.height ?? 720
  try {
    const meta = await base.metadata()
    if (meta.width && meta.height) { width = meta.width; height = meta.height }
  } catch { /* fall back to defaults */ }

  // Pre-decompose the lines with the emphasis word colorized inline.
  const line1 = colorizeEmphasis(copy.line1.toUpperCase(), copy.emphasisWord)
  const line2 = colorizeEmphasis(copy.line2.toUpperCase(), copy.emphasisWord)

  // Font sizes scale with the smaller of the two dimensions so the bake
  // looks consistent on 1280×720, 1920×1080, or square crops. Reference
  // sizes from Gemini's handoff: line1 85px, line2 ~70px at 1280×720.
  // We add a faint floor so very small thumbnails still legible.
  const scaleBase = Math.max(360, Math.min(width, height * 16 / 9))
  const fontSizeLine1 = Math.round(scaleBase * 0.118)  // ~85px at 1280×720
  const fontSizeLine2 = Math.round(scaleBase * 0.098)  // ~70px at 1280×720

  // Anchor — Gemini-default is upper-left when product is on the right.
  // For upper-right variants we mirror the x and use text-anchor=end.
  const anchor = opts.anchor ?? 'upper-left'
  const x = anchor === 'upper-left' ? Math.round(width * 0.062) : Math.round(width * 0.938)
  const yLine1 = Math.round(height * 0.194)
  const yLine2 = yLine1 + fontSizeLine2 + Math.round(scaleBase * 0.014)
  const textAnchor = anchor === 'upper-left' ? 'start' : 'end'

  // Vector overlay. Notes:
  //  - paint-order: stroke fill = stroke renders BEHIND fill, so the black
  //    outline doesn't eat into the letter shapes.
  //  - stroke-linejoin: round prevents jagged corners on bold sans-serif.
  //  - We use a generic font stack (Impact → Anton → sans-serif) — sharp
  //    will fall back to whatever's installed. In Vercel/Node runtime the
  //    fallback usually lands on Liberation Sans Bold which is close enough
  //    to Impact for our look. (Future polish: bundle a real Impact-style
  //    woff2.)
  //  - The -3° slant via `transform="rotate"` matches the viral aesthetic
  //    Gemini called out — slight tilt = more energy, more click-feel.
  const strokeWidth = Math.round(scaleBase * 0.0195)  // ~14px at 1280×720
  const dropShadowDy = Math.round(scaleBase * 0.008)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="ds" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="${dropShadowDy}" stdDeviation="${Math.round(scaleBase * 0.003)}" flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <style>
    .h {
      font-family: 'Impact', 'Anton', 'Arial Black', 'Liberation Sans', sans-serif;
      font-weight: 900;
      fill: #FFFFFF;
      paint-order: stroke fill;
      stroke: #000000;
      stroke-width: ${strokeWidth}px;
      stroke-linejoin: round;
      letter-spacing: -1px;
    }
  </style>
  <g transform="rotate(-3, ${x}, ${yLine1})" filter="url(#ds)">
    <text x="${x}" y="${yLine1}" class="h" font-size="${fontSizeLine1}" text-anchor="${textAnchor}">${line1}</text>
    <text x="${x}" y="${yLine2}" class="h" font-size="${fontSizeLine2}" text-anchor="${textAnchor}">${line2}</text>
  </g>
</svg>`

  try {
    const png = await base
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer()
    return { png, width, height, renderError: null as unknown as undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[simple-bake] composite failed, returning bare base:', message)
    // Return the un-textified base so the caller can still ship something.
    try {
      const bare = await sharp(baseImage).jpeg({ quality: 90 }).toBuffer()
      return { png: bare, width, height, renderError: message }
    } catch {
      // Truly catastrophic — return the original bytes unchanged.
      return { png: baseImage, width, height, renderError: message }
    }
  }
}
