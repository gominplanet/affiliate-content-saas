// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP'S PDF TEMPLATE (Seb, 2026-10-14: "can we use mvp logos and style for
// the design of these PDF. make yourself a template pdf that has all of the
// MVP styles, colors then all you need for each user is to apply the content
// and brand logos").
//
// One look for every PDF MVP makes: the logo, the brand colors (navy and the
// blue to violet of the logo's check, MVP purple for actions), Plus Jakarta
// Sans, a cover, a header and footer on every page, section titles, chips,
// tiles, tables and a brand badge (a brand's own logo, or its initial). Each
// PDF brings only its content. Drawn with jsPDF, so it runs in the browser
// and in node (the guards render one).
//
// The brand files (lib/pdf-brand/assets.ts) are passed in, not imported, so a
// page that never makes a PDF never loads them. Without them the template
// still works: Helvetica and the MVP name in place of the logo.

import type { jsPDF } from 'jspdf'

export type RGB = [number, number, number]

/** MVP's colors, from the logo and the app. */
export const BRAND = {
  navy: [11, 27, 56] as RGB, // the logo's M and wordmark
  blue: [59, 130, 246] as RGB, // the top of the logo's check
  indigo: [80, 65, 243] as RGB, // the logo's check
  purple: [124, 58, 237] as RGB, // MVP's accent in the app
  ink: [24, 24, 27] as RGB,
  soft: [100, 104, 120] as RGB,
  line: [226, 228, 238] as RGB,
  panel: [248, 248, 252] as RGB,
  tint: [242, 240, 255] as RGB,
  green: [22, 163, 74] as RGB,
  amber: [180, 83, 9] as RGB,
  red: [220, 38, 38] as RGB,
  white: [255, 255, 255] as RGB,
}

export const PAGE = { W: 612, H: 792, M: 44, BOTTOM: 792 - 56 }

export interface BrandAssets {
  /** Plus Jakarta Sans as base64 TrueType, three weights. */
  fonts?: { regular: string; bold: string; heavy: string } | null
  /** The full logo and the mark alone, as image data URLs. */
  logo?: string | null
  mark?: string | null
}

/** The brand files, loaded when a PDF is made. Browser and node. */
export async function loadBrandAssets(): Promise<BrandAssets> {
  const a = await import('@/lib/pdf-brand/assets')
  return { fonts: { regular: a.JAKARTA_400, bold: a.JAKARTA_700, heavy: a.JAKARTA_800 }, logo: a.MVP_LOGO_JPEG, mark: a.MVP_MARK_JPEG }
}

export type Weight = 'normal' | 'bold' | 'heavy'

/** The drawing kit for one document. */
export interface Kit {
  doc: jsPDF
  assets: BrandAssets
  family: string
  color: (c: RGB) => void
  fill: (c: RGB) => void
  stroke: (c: RGB) => void
  font: (size: number, weight?: Weight | boolean) => void
  /** Text the document's font can draw (see safeText). */
  safe: (t: string | null | undefined) => string
  lines: (t: string, width: number) => string[]
  lh: (size: number) => number
}

/** Text the PDF can draw: emoji and symbols outside Latin-1 dropped, dashes
 *  as plain hyphens (no long dashes in MVP's copy), curly quotes kept when the
 *  brand font is in. Pure. */
export function safeText(t: string | null | undefined, curly = true): string {
  let s = String(t ?? '')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/™/g, '(TM)').replace(/[•·]/g, '-')
    .replace(/[   ]/g, ' ')
  if (!curly) s = s.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
  return s.replace(curly ? /[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF‘’“”]/g : /[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, '')
    .replace(/[ \t]+/g, ' ').trim()
}

/** Sets the brand font on a document and returns the drawing kit. */
export function brandKit(doc: jsPDF, assets: BrandAssets = {}): Kit {
  let family = 'helvetica'
  if (assets.fonts) {
    try {
      doc.addFileToVFS('Jakarta-400.ttf', assets.fonts.regular); doc.addFont('Jakarta-400.ttf', 'Jakarta', 'normal')
      doc.addFileToVFS('Jakarta-700.ttf', assets.fonts.bold); doc.addFont('Jakarta-700.ttf', 'Jakarta', 'bold')
      doc.addFileToVFS('Jakarta-800.ttf', assets.fonts.heavy); doc.addFont('Jakarta-800.ttf', 'Jakarta', 'heavy')
      family = 'Jakarta'
    } catch { family = 'helvetica' }
  }
  const curly = family === 'Jakarta'
  const kit: Kit = {
    doc, assets, family,
    color: (c) => doc.setTextColor(c[0], c[1], c[2]),
    fill: (c) => doc.setFillColor(c[0], c[1], c[2]),
    stroke: (c) => doc.setDrawColor(c[0], c[1], c[2]),
    font: (size, weight = 'normal') => {
      const w: Weight = weight === true ? 'bold' : weight === false ? 'normal' : weight
      doc.setFont(family, family === 'helvetica' && w === 'heavy' ? 'bold' : w)
      doc.setFontSize(size)
    },
    safe: (t) => safeText(t, curly),
    lines: (t, width) => doc.splitTextToSize(safeText(t, curly), width) as string[],
    lh: (size) => size * 1.36,
  }
  return kit
}

/** The logo's check, as a horizontal blue to violet bar. */
export function gradientBar(k: Kit, x: number, y: number, w: number, h: number, from: RGB = BRAND.blue, to: RGB = BRAND.purple) {
  const steps = Math.max(12, Math.round(w / 6))
  const sw = w / steps
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    k.fill([0, 1, 2].map((j) => Math.round(from[j] + (to[j] - from[j]) * t)) as RGB)
    k.doc.rect(x + i * sw, y, sw + 0.4, h, 'F')
  }
}

const imgType = (data: string) => (data.startsWith('data:image/png') ? 'PNG' : 'JPEG')

/** The header on every page after the cover: the mark, the document's name,
 *  and what it covers on the right, over a thin brand line. */
export function drawHeader(k: Kit, title: string, right?: string) {
  const { W, M } = PAGE
  const { doc } = k
  let x = M
  if (k.assets.mark) { try { doc.addImage(k.assets.mark, imgType(k.assets.mark), M, 16, 22, 19, undefined, 'FAST'); x = M + 30 } catch { /* name only */ } }
  k.font(8.5, 'heavy'); k.color(BRAND.navy); doc.text(k.safe(title).toUpperCase(), x, 29, { charSpace: 0.6 })
  if (right) { k.font(8.5); k.color(BRAND.soft); doc.text(k.safe(right), W - M, 29, { align: 'right' }) }
  gradientBar(k, M, 40, W - 2 * M, 1.6)
}

/** A cover: the logo, a short label above the title, the title, a line under
 *  it. Returns where the content goes next. */
export function drawCover(k: Kit, o: { eyebrow: string; title: string; subtitle?: string; meta?: string }): number {
  const { W, M } = PAGE
  const { doc } = k
  gradientBar(k, 0, 0, W, 8)
  let y = 46
  if (k.assets.logo) {
    try { doc.addImage(k.assets.logo, imgType(k.assets.logo), M, y, 56, 79, undefined, 'FAST') } catch { /* name below */ }
  } else { k.font(13, 'heavy'); k.color(BRAND.navy); doc.text('MVP AFFILIATE', M, y + 14) }
  if (o.meta) { k.font(9); k.color(BRAND.soft); doc.text(k.safe(o.meta), W - M, y + 12, { align: 'right' }) }
  y += 112
  k.font(9.5, 'heavy'); k.color(BRAND.indigo); doc.text(k.safe(o.eyebrow).toUpperCase(), M, y, { charSpace: 1.2 })
  y += 12
  k.font(34, 'heavy'); k.color(BRAND.navy)
  for (const l of k.lines(o.title, W - 2 * M)) { y += 38; doc.text(l, M, y) }
  if (o.subtitle) {
    y += 8
    k.font(12); k.color(BRAND.soft)
    for (const l of k.lines(o.subtitle, W - 2 * M - 60)) { y += 17; doc.text(l, M, y) }
  }
  y += 18
  gradientBar(k, M, y, 64, 3)
  return y + 26
}

/** Every page's footer, once the document is done: who made it, and page n
 *  of N. The cover has none. */
export function drawFooters(k: Kit, label = 'Made with MVP Affiliate  |  mvpaffiliate.io') {
  const { W, H, M } = PAGE
  const { doc } = k
  const n = doc.getNumberOfPages()
  for (let i = 2; i <= n; i++) {
    doc.setPage(i)
    k.stroke(BRAND.line); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34)
    k.font(8); k.color(BRAND.soft)
    doc.text(k.safe(label), M, H - 22)
    doc.text(`Page ${i} of ${n}`, W - M, H - 22, { align: 'right' })
  }
}

export type Tone = 'indigo' | 'green' | 'amber' | 'red' | 'soft' | 'navy'
const TONES: Record<Tone, { bg: RGB; fg: RGB }> = {
  indigo: { bg: [236, 234, 254], fg: BRAND.indigo },
  green: { bg: [220, 245, 230], fg: [21, 128, 61] },
  amber: { bg: [254, 240, 220], fg: BRAND.amber },
  red: { bg: [254, 228, 228], fg: [185, 28, 28] },
  soft: { bg: [238, 239, 244], fg: BRAND.soft },
  navy: { bg: BRAND.navy, fg: BRAND.white },
}

/** A small rounded label. Returns its width. */
export function chip(k: Kit, text: string, x: number, y: number, tone: Tone = 'indigo', size = 7.5): number {
  const t = TONES[tone]
  const s = k.safe(text)
  k.font(size, 'bold')
  const w = k.doc.getTextWidth(s) + 12
  k.fill(t.bg); k.doc.roundedRect(x, y, w, size + 7, (size + 7) / 2, (size + 7) / 2, 'F')
  k.color(t.fg); k.doc.text(s, x + 6, y + size + 2.2)
  return w
}

/** A number tile: big value, short label, a brand line on top. */
export function tile(k: Kit, x: number, y: number, w: number, value: string, label: string, accent: RGB = BRAND.indigo, h = 74) {
  k.fill(BRAND.panel); k.stroke(BRAND.line); k.doc.setLineWidth(0.7); k.doc.roundedRect(x, y, w, h, 10, 10, 'FD')
  k.fill(accent); k.doc.roundedRect(x + 12, y, w - 24, 3, 1.5, 1.5, 'F')
  k.font(24, 'heavy'); k.color(accent); k.doc.text(k.safe(value), x + 14, y + 38)
  k.font(9); k.color(BRAND.soft)
  k.lines(label, w - 28).slice(0, 2).forEach((l, i) => k.doc.text(l, x + 14, y + 55 + i * 11))
}

/** A brand's own logo in a rounded square, or its initial on the brand
 *  indigo when there is no logo. */
export function brandBadge(k: Kit, x: number, y: number, size: number, name: string, logo?: string | null) {
  const { doc } = k
  k.fill(BRAND.white); k.stroke(BRAND.line); doc.setLineWidth(0.7); doc.roundedRect(x, y, size, size, size * 0.22, size * 0.22, 'FD')
  if (logo) {
    try { doc.addImage(logo, imgType(logo), x + 3, y + 3, size - 6, size - 6, undefined, 'FAST'); return } catch { /* the initial below */ }
  }
  k.fill(BRAND.tint); doc.roundedRect(x, y, size, size, size * 0.22, size * 0.22, 'F')
  k.font(size * 0.46, 'heavy'); k.color(BRAND.indigo)
  doc.text(k.safe(name).slice(0, 1).toUpperCase() || '?', x + size / 2, y + size * 0.66, { align: 'center' })
}

/** A section title, with an optional line under it. Returns the new y. */
export function sectionTitle(k: Kit, y: number, title: string, sub?: string): number {
  const { W, M } = PAGE
  k.font(19, 'heavy'); k.color(BRAND.navy); k.doc.text(k.safe(title), M, y + 19)
  y += 28
  if (sub) {
    k.font(10); k.color(BRAND.soft)
    for (const l of k.lines(sub, W - 2 * M)) { k.doc.text(l, M, y + 10); y += 14 }
  }
  return y + 8
}

export interface Column { label: string; width: number; align?: 'left' | 'right' | 'center' }
export interface Cell { text: string; tone?: Tone | 'link' | 'plain'; url?: string | null; bold?: boolean }

/** A table with a header row, wrapped cells, soft stripes and chips for
 *  toned cells. Breaks across pages with the header repeated; `newPage` is
 *  the document's own (it draws the page header and returns the top y).
 *  Returns the y under the table. */
export function table(k: Kit, y: number, x: number, columns: Column[], rows: Cell[][], newPage: () => number): number {
  const { BOTTOM } = PAGE
  const { doc } = k
  const totalW = columns.reduce((n, c) => n + c.width, 0)
  const head = (yy: number) => {
    k.fill(BRAND.navy); doc.roundedRect(x, yy, totalW, 20, 5, 5, 'F')
    k.font(7.5, 'bold'); k.color(BRAND.white)
    let cx = x
    for (const c of columns) {
      const tx = c.align === 'right' ? cx + c.width - 8 : c.align === 'center' ? cx + c.width / 2 : cx + 8
      doc.text(k.safe(c.label).toUpperCase(), tx, yy + 13, { align: c.align || 'left', charSpace: 0.4 })
      cx += c.width
    }
    return yy + 24
  }
  y = head(y)
  rows.forEach((row, ri) => {
    k.font(9)
    const cellLines = row.map((cell, ci) => (cell.tone && cell.tone !== 'link' && cell.tone !== 'plain' ? [k.safe(cell.text)] : k.lines(cell.text || '', columns[ci].width - 16)))
    const h = Math.max(22, Math.max(...cellLines.map((l) => l.length)) * 12 + 10)
    if (y + h > BOTTOM) { y = head(newPage()) }
    if (ri % 2 === 1) { k.fill(BRAND.panel); doc.rect(x, y - 2, totalW, h, 'F') }
    let cx = x
    row.forEach((cell, ci) => {
      const c = columns[ci]
      if (cell.tone && cell.tone !== 'link' && cell.tone !== 'plain') {
        k.font(7.5, 'bold')
        const cw = doc.getTextWidth(k.safe(cell.text)) + 12
        chip(k, cell.text, c.align === 'right' ? cx + c.width - 8 - cw : cx + 8, y + 3, cell.tone)
      } else {
        k.font(9, cell.bold ? 'bold' : 'normal')
        k.color(cell.tone === 'link' ? BRAND.indigo : BRAND.ink)
        cellLines[ci].forEach((l, li) => {
          const tx = c.align === 'right' ? cx + c.width - 8 : c.align === 'center' ? cx + c.width / 2 : cx + 8
          if (cell.url && li === 0) doc.textWithLink(l, tx, y + 11 + li * 12, { url: cell.url, align: c.align || 'left' })
          else doc.text(l, tx, y + 11 + li * 12, { align: c.align || 'left' })
        })
      }
      cx += c.width
    })
    y += h
  })
  k.stroke(BRAND.line); doc.setLineWidth(0.5); doc.line(x, y + 2, x + totalW, y + 2)
  return y + 10
}
