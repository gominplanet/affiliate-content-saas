// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared safe-zone + auto-fit helpers used by every template. Centralised so
// "text shouldn't bleed close to the edges" is enforced in ONE place — when
// we tighten the margins or change the auto-fit math, every template
// improves in lockstep instead of each having to be updated individually.
//
// Why these specific margins (1280 × 720 reference):
//   - Horizontal 6% (77px) keeps text clear of the YouTube duration overlay
//     and the platform's auto-crop on small mobile players.
//   - Vertical 8% (58px) gives breathing room above/below so the text reads
//     as deliberate composition, not as something jammed against the edge.

/** Reference glyph-width-per-fontSize ratio for our display fonts. Anton +
 *  Bangers + RussoOne all hover around 0.55 (slightly condensed sans). Used
 *  to estimate how wide a line will render at a given font size so we can
 *  auto-fit without measuring text. Conservative — better to under-estimate
 *  size than overflow. */
export const GLYPH_WIDTH_RATIO = 0.55

/** Line-height multiplier for stacked display lines. 0.92 is tight enough to
 *  look like a deliberate stack, loose enough to keep ascenders/descenders
 *  from kissing. */
export const STACK_LINE_HEIGHT = 0.92

export interface SafeZone {
  /** Horizontal margin from each canvas edge (matching left + right). */
  hMargin: number
  /** Vertical margin from each canvas edge (matching top + bottom). */
  vMargin: number
  /** Usable canvas width = width − 2× hMargin. */
  innerWidth: number
  /** Usable canvas height = height − 2× vMargin. */
  innerHeight: number
}

/**
 * Compute the safe-zone bounds for a canvas of the given dimensions. Every
 * template should fetch this and treat (hMargin, vMargin) as a hard inset
 * — no text or decorative element should extend past it.
 */
export function safeZone(width: number, height: number): SafeZone {
  const hMargin = Math.round(width * 0.06)
  const vMargin = Math.round(height * 0.08)
  return {
    hMargin,
    vMargin,
    innerWidth: width - hMargin * 2,
    innerHeight: height - vMargin * 2,
  }
}

/**
 * Given a stack of lines + the column they must fit in, return the LARGEST
 * font size that keeps every line within the column inner width AND keeps
 * the total stacked height within the column inner height.
 *
 * The line-height multiplier defaults to STACK_LINE_HEIGHT (tight). Pass a
 * larger value when individual lines should have visible gaps between them.
 *
 * `targetCeiling` is the size the caller WANTS to use if the geometry
 * allows — typically `Math.min(colWidth * 0.4, height * 0.4)` or similar.
 * The returned size is `min(targetCeiling, widthFit, heightFit)`.
 */
export function fitStackedFontSize(opts: {
  lines: string[]
  columnInnerWidth: number
  columnInnerHeight: number
  targetCeiling: number
  glyphRatio?: number
  lineHeight?: number
}): number {
  const glyphRatio = opts.glyphRatio ?? GLYPH_WIDTH_RATIO
  const lh = opts.lineHeight ?? STACK_LINE_HEIGHT
  const longestChars = Math.max(1, ...opts.lines.map(l => l.length))
  // Max size that keeps the LONGEST line within the column width.
  const fitByWidth = opts.columnInnerWidth / (longestChars * glyphRatio)
  // Max size that keeps the STACK total height within the column height.
  // (linesCount × fontSize × lh) ≤ innerHeight
  const fitByHeight = opts.columnInnerHeight / (opts.lines.length * lh)
  return Math.floor(Math.min(opts.targetCeiling, fitByWidth, fitByHeight))
}
