// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Hand-composited WIDE banner (X/Bluesky 3:1, LinkedIn 4:1). No image model can
// render an extreme-wide banner AND clean text — Ideogram fills the width but
// bakes garbled subtitles / fake nav bars; gpt-image renders clean text but only
// at 1.5:1 (crops badly at 4:1). So we split the job:
//   1. Ideogram generates a TEXT-FREE dark background + product hero on the right.
//   2. We bake the headline ourselves as opentype.js vector PATHS → Resvg → sharp
//      (the exact proven pipeline lib/thumbnail-simple-bake uses in prod — a
//      bundled Anton TTF, no font-matching, no silent failures), with the accent
//      word in the brand colour.
//   3. We composite the creator's REAL logo hard-left over a soft dark scrim.
// Result: edge-to-edge, nothing clipped, razor-sharp text that CANNOT garble.

import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
// opentype.js is CJS; Next's bundler wraps it inconsistently across runtimes, so
// resolve .parse across both shapes (same interop dance as thumbnail-simple-bake).
import * as opentypeNs from 'opentype.js'
import type { Font, Path as OpentypePath } from 'opentype.js'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

let _parse: ((buf: ArrayBuffer) => Font) | null = null
function getParse(): (buf: ArrayBuffer) => Font {
  if (_parse) return _parse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ns = opentypeNs as any
  if (typeof ns.parse === 'function') { _parse = ns.parse.bind(ns); return _parse! }
  if (ns.default && typeof ns.default.parse === 'function') { _parse = ns.default.parse.bind(ns.default); return _parse! }
  throw new Error('opentype.js: neither .parse nor .default.parse is a function')
}

let cachedFont: Font | null = null
function loadAnton(): Font {
  if (cachedFont) return cachedFont
  const candidates = [
    path.join(process.cwd(), 'public', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), 'lib', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), '..', 'public', 'fonts', 'Anton-Regular.ttf'),
    path.join(process.cwd(), '..', 'lib', 'fonts', 'Anton-Regular.ttf'),
  ]
  const parse = getParse()
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const buf = readFileSync(p)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    cachedFont = parse(ab as ArrayBuffer)
    return cachedFont
  }
  throw new Error(`Anton TTF not found. Tried: ${candidates.join(' OR ')}`)
}

/** Largest size where `text` fits `maxWidth` (exact opentype advance metrics). */
function fitFont(font: Font, text: string, ceil: number, maxWidth: number, min: number): number {
  if (!text || maxWidth <= 0) return ceil
  const w = font.getAdvanceWidth(text.toUpperCase(), ceil)
  if (w <= maxWidth) return ceil
  return Math.max(min, Math.floor(ceil * (maxWidth / w)))
}

/** One line → SVG <path> chunks, with the emphasis run painted in `accent`. */
function lineToPaths(font: Font, line: string, emphasis: string, size: number, startX: number, baselineY: number, accent: string): { paths: string; total: number } {
  const upper = line.toUpperCase()
  const ue = (emphasis || '').toUpperCase().trim()
  const segs: Array<{ t: string; e: boolean }> = []
  if (ue && upper.includes(ue)) {
    const i = upper.indexOf(ue)
    if (i > 0) segs.push({ t: upper.slice(0, i), e: false })
    segs.push({ t: ue, e: true })
    const tail = upper.slice(i + ue.length)
    if (tail) segs.push({ t: tail, e: false })
  } else {
    segs.push({ t: upper, e: false })
  }
  const widths = segs.map(s => font.getAdvanceWidth(s.t, size))
  const total = widths.reduce((a, b) => a + b, 0)
  let pen = startX
  let out = ''
  for (let i = 0; i < segs.length; i++) {
    const p: OpentypePath = font.getPath(segs[i].t, pen, baselineY, size)
    out += `<path d="${p.toPathData(2)}" fill="${segs[i].e ? accent : '#FFFFFF'}"/>`
    pen += widths[i]
  }
  return { paths: out, total }
}

/** Break a headline into ≤3 balanced UPPERCASE lines — split at a comma when
 *  present, otherwise pack words two-ish per line. */
function splitHeadline(headline: string): string[] {
  const clean = headline.replace(/\s+/g, ' ').trim()
  if (!clean) return ['REAL REVIEWS']
  // Prefer the comma break ("Real Reviews, Smarter Choices" → 2 lines).
  if (clean.includes(',')) {
    const parts = clean.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length === 2) return [parts[0] + ',', parts[1]]
  }
  const words = clean.split(' ')
  if (words.length <= 2) return [clean]
  if (words.length <= 4) {
    const mid = Math.ceil(words.length / 2)
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
  }
  // 5+ words → 3 lines
  const third = Math.ceil(words.length / 3)
  return [words.slice(0, third).join(' '), words.slice(third, third * 2).join(' '), words.slice(third * 2).join(' ')].filter(Boolean)
}

/** Pick the word to emphasise in the brand colour: the first word of the last
 *  line (e.g. "SMARTER" in "…/ Smarter Choices"), else the longest word. */
function pickAccentWord(lines: string[]): string {
  const last = lines[lines.length - 1] || ''
  const firstOfLast = last.split(' ')[0]?.replace(/[^A-Za-z]/g, '')
  if (firstOfLast && firstOfLast.length >= 3) return firstOfLast
  const all = lines.join(' ').split(' ').map(w => w.replace(/[^A-Za-z]/g, ''))
  return all.sort((a, b) => b.length - a.length)[0] || ''
}

async function compositeLogoLeft(banner: Buffer, logo: Buffer, W: number, H: number): Promise<Buffer> {
  const logoPng = await sharp(logo)
    .resize({ width: Math.round(W * 0.13), height: Math.round(H * 0.52), fit: 'inside', withoutEnlargement: false })
    .png().toBuffer()
  const lm = await sharp(logoPng).metadata()
  const lh = lm.height ?? Math.round(H * 0.52)
  const left = Math.round(W * 0.02)
  const top = Math.round((H - lh) / 2)
  const panelW = Math.round(W * 0.15)
  const scrim = Buffer.from(
    `<svg width="${panelW}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0A0A0A" stop-opacity="0.82"/><stop offset="55%" stop-color="#0A0A0A" stop-opacity="0.45"/><stop offset="100%" stop-color="#0A0A0A" stop-opacity="0"/></linearGradient></defs><rect width="${panelW}" height="${H}" fill="url(#g)"/></svg>`,
  )
  return sharp(banner).composite([{ input: scrim, left: 0, top: 0 }, { input: logoPng, left, top }]).png().toBuffer()
}

export interface WideBannerOptions {
  background: Buffer          // wide, text-free bg + product hero (Ideogram)
  logo?: Buffer | null        // creator's real logo (composited hard-left)
  headline: string            // e.g. "Real Reviews, Smarter Choices"
  accentColor?: string        // brand accent for the emphasis word (default gold)
  targetW: number
  targetH: number
}

/**
 * Compose the final wide banner: text-free background (cover-fit to exact dims) →
 * real logo hard-left on a scrim → baked headline (Anton vector paths, accent
 * word in brand colour, black stroke + drop shadow so it reads over products).
 * Throws only if the font can't load — caller falls back to the 1.5:1 path.
 */
export async function composeWideBanner(opts: WideBannerOptions): Promise<Buffer> {
  const W = opts.targetW
  const H = opts.targetH
  const accent = opts.accentColor || '#E7B84B'
  const hasLogo = !!opts.logo

  let base = await sharp(opts.background).resize(W, H, { fit: 'cover', position: 'centre' }).png().toBuffer()
  if (opts.logo) base = await compositeLogoLeft(base, opts.logo, W, H)

  // ── Bake the headline as opentype vector paths ──────────────────────────
  const font = loadAnton()
  const lines = splitHeadline(opts.headline)
  const accentWord = pickAccentWord(lines)
  // Text column: clear of the logo on the left, clear of the product hero on the
  // right. Auto-fit the font so the longest line fits the column at a uniform size.
  const leftPad = Math.round(W * (hasLogo ? 0.255 : 0.08))
  const colW = Math.round(W * 0.42)
  const ceil = Math.round(H * 0.30)
  const minS = Math.round(H * 0.13)
  const size = Math.min(...lines.map(l => fitFont(font, l, ceil, colW, minS)))
  const lineH = Math.round(size * 1.02)
  const blockH = lineH * lines.length
  let y = Math.round(H / 2 - blockH / 2 + size * 0.80)   // first baseline, block vertically centred
  let body = ''
  for (const l of lines) {
    body += lineToPaths(font, l, accentWord, size, leftPad, y, accent).paths
    y += lineH
  }
  const strokeW = Math.max(2, Math.round(size * 0.05))
  const shadow = Math.max(2, Math.round(H * 0.008))
  const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ds" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${shadow}" stdDeviation="${shadow}" flood-color="#000" flood-opacity="0.6"/></filter></defs><g stroke="#000000" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill" filter="url(#ds)">${body}</g></svg>`
  const textPng = new Resvg(textSvg, { fitTo: { mode: 'width', value: W }, background: 'rgba(0,0,0,0)' }).render().asPng()

  return sharp(base).composite([{ input: textPng, top: 0, left: 0 }]).png().toBuffer()
}
