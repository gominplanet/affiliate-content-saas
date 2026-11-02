// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR THUMBNAIL LOOK (Seb, 2026-11-02: "i want one of our MVP looks
// for thumbnails to look like this one"). A real frame of the creator from
// their own review, big and bright; two to four words across the top in a
// heavy serif (Playfair Display), white with a soft shadow; one word with a
// thick red bar under it; and the creator's head in front of the words, so
// they sit in the picture rather than on it. No arrows, badges or emoji.
//
// Drawn here, not by an image model, so the words are spelled right, the
// font is the same every time and the red bar is exactly under its word. The
// creator is cut out of the frame (lib/thumbnail-generators removeBackground)
// only to lay their head over the words. When there is no cut-out, or the
// head would hide too much of the words, the words go in front and the
// result says so (depth: false), never quietly.
//
// The frame, the words and the cut-out come from lib/review-edit-server
// (makeCreatorThumb). Everything here is pure or local: sharp, satori, resvg.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const THUMB_W = 1280
export const THUMB_H = 720
/** The one accent colour. */
export const THUMB_RED = '#E0251B'

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Crop { left: number; top: number; width: number; height: number }

let serif: Buffer | null = null
function serifFont(): Buffer {
  if (serif) return serif
  const rel = join('@fontsource', 'playfair-display', 'files', 'playfair-display-latin-800-normal.woff')
  for (const base of [process.cwd(), join(process.cwd(), '..')]) {
    const p = join(base, 'node_modules', rel)
    if (existsSync(p)) return (serif = readFileSync(p))
  }
  throw new Error('thumbnail font not found (node_modules/@fontsource/playfair-display)')
}

/** The box round everything at least half opaque in an alpha channel, or
 *  null when there is next to nothing (under 1% of the frame). Pure. */
export function alphaBox(alpha: Uint8Array | Buffer, w: number, h: number, threshold = 128): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] >= threshold) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  return n < w * h * 0.01 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** A 16:9 window of the frame that makes the creator bigger and puts the top
 *  of their head about a third of the way down, under the words. Zooms 1.5
 *  times at most, so a 1080p frame is never stretched. Pure. */
export function cropFor(person: Box | null, W: number, H: number): Crop {
  // The largest 16:9 window the frame holds.
  let fullW = W, fullH = Math.round(W * 9 / 16)
  if (fullH > H) { fullH = H; fullW = Math.round(H * 16 / 9) }
  if (!person) return { left: Math.round((W - fullW) / 2), top: Math.round((H - fullH) / 2), width: fullW, height: fullH }
  const headTop = person.y0, r = 0.3
  // Room above the head for it to land at r, and room below for the rest.
  const fits = Math.min(headTop > 0 ? headTop / r : 0, (H - headTop) / (1 - r))
  const ch = Math.round(Math.max(fullH / 1.5, Math.min(fullH, fits || fullH)))
  const cw = Math.round(ch * 16 / 9)
  const cx = (person.x0 + person.x1) / 2
  const left = Math.round(Math.min(Math.max(0, cx - cw / 2), W - cw))
  const top = Math.round(Math.min(Math.max(0, headTop - r * ch), H - ch))
  return { left, top, width: cw, height: ch }
}

/** The words as lines: one line when it fits, else two of about even length.
 *  Pure. */
export function splitLines(words: string, twoLines: boolean): string[][] {
  const w = words.trim().split(/\s+/).filter(Boolean)
  if (!twoLines || w.length < 2) return [w]
  let best = 1, diff = Infinity
  for (let i = 1; i < w.length; i++) {
    const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length)
    if (d < diff) { diff = d; best = i }
  }
  return [w.slice(0, best), w.slice(best)]
}

/** Acronyms that stay in capitals when a headline written in capitals is
 *  set lowercase; a word with a number in it (X100, 4K) stays too. */
const ACRONYMS = new Set(['USB', 'LED', 'UV', 'TV', 'PC', 'HD', 'UHD', 'USA', 'UK', 'GPS', 'AI', 'UPF', 'SPF', 'LCD', 'OLED', 'RGB', 'DIY', 'XL', 'XXL', 'XS', 'BBQ', 'EV', 'AC', 'DC', 'HDMI', 'SSD', 'RAM', 'CPU', 'GPU', 'VR', 'AR', 'NFC', 'ANC', 'MPH', 'PSI', 'OZ', 'MM', 'CM', 'LB', 'LBS', 'KG'])

/** The words for the Creator look, from any headline: four at most, no
 *  dashes, year, hashtag or emoji, and lowercase when written in capitals
 *  (an acronym or a model number stays as it is); the red bar on the word
 *  asked for, else the last. Null when nothing is left. Pure. */
export function creatorWords(text: unknown, accent: unknown = ''): { words: string; accent: string } | null {
  const w = String(text ?? '').replace(/[\u2013\u2014]/g, ' ').replace(/\s+-\s+/g, ' ').replace(/#\S*/g, '').replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/[^\p{L}\p{N}'\u2019!?,.& ]/gu, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 4)
  if (!w.length) return null
  const shouting = w.every((x) => x === x.toUpperCase())
  const out = shouting ? w.map((x) => (/\d/.test(x) || ACRONYMS.has(x.replace(/[^A-Z]/g, '')) ? x : x.toLowerCase())) : w
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9']/g, '')
  const a = norm(String(accent ?? ''))
  return { words: out.join(' '), accent: out.find((x) => norm(x) === a) ?? out[out.length - 1] }
}

/** Which word gets the red bar: the one asked for, else the last. Pure. */
export function accentIndex(words: string, accent: string): number {
  const w = words.trim().split(/\s+/).filter(Boolean)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '')
  const want = norm(accent)
  const i = want ? w.findIndex((x) => norm(x) === want) : -1
  return i >= 0 ? i : w.length - 1
}

/** The share of the words' own pixels that the creator covers. Pure. */
export function hiddenShare(words: Uint8Array | Buffer, person: Uint8Array | Buffer): number {
  let shown = 0, hidden = 0
  for (let i = 0; i < words.length; i++) {
    if (words[i] < 128) continue
    shown++
    if (person[i] >= 128) hidden++
  }
  return shown ? hidden / shown : 0
}

/** The words drawn at a size, trimmed to what is drawn, as a transparent PNG. */
async function drawWords(lines: string[][], accent: number, px: number, align: 'left' | 'center' | 'right'): Promise<{ png: Buffer; width: number; height: number }> {
  const [{ default: satori }, { Resvg }, { default: sharp }] = await Promise.all([import('satori'), import('@resvg/resvg-js'), import('sharp')])
  const barH = Math.max(8, Math.round(px * 0.17))
  let k = 0
  const lineEls = lines.map((line) => ({
    type: 'div',
    props: {
      style: { display: 'flex', justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', gap: Math.round(px * 0.24) },
      children: line.map((word) => {
        const isAccent = k++ === accent
        return {
          type: 'div',
          props: {
            style: { display: 'flex', position: 'relative', lineHeight: 1.06 },
            children: [
              // The red bar sits low behind the word, the letters over it.
              ...(isAccent ? [{ type: 'div', props: { style: { position: 'absolute', left: -Math.round(px * 0.04), right: -Math.round(px * 0.04), bottom: Math.round(px * 0.06), height: barH, backgroundColor: THUMB_RED, borderRadius: Math.round(barH / 3) } } }] : []),
              { type: 'span', props: { style: { color: '#FFFFFF', textShadow: `0px ${Math.round(px * 0.04)}px ${Math.round(px * 0.16)}px rgba(0,0,0,0.5)` }, children: word } },
            ],
          },
        }
      }),
    },
  }))
  const W = THUMB_W * 2
  const tree = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', width: '100%', height: '100%', padding: px, fontFamily: 'Playfair Display', fontWeight: 800, fontSize: px, letterSpacing: -Math.round(px * 0.01) },
      children: lineEls,
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(tree as any, { width: W, height: Math.round(px * (lines.length * 1.1 + 3)), fonts: [{ name: 'Playfair Display', data: serifFont(), weight: 800, style: 'normal' }] })
  const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: 'rgba(0,0,0,0)' }).render().asPng()
  const { data, info } = await sharp(raw).trim().png().toBuffer({ resolveWithObject: true })
  return { png: data, width: info.width, height: info.height }
}

/** The biggest size the words fit an area at, in up to two lines. */
async function fitWords(words: string, accent: number, area: { w: number; h: number }, align: 'left' | 'center' | 'right', maxPx: number) {
  // One line, or two when two make the words at least a third bigger (a
  // narrow space beside the head), as big as the space allows.
  const size = async (two: boolean) => {
    const lines = splitLines(words, two)
    const probe = await drawWords(lines, accent, 100, align)
    return { lines, px: Math.floor(Math.min(maxPx, 100 * area.w / probe.width, 100 * area.h / probe.height)) }
  }
  const one = await size(false)
  const two = one.lines[0].length >= 2 ? await size(true) : null
  const pick = two && two.px >= one.px * 1.33 ? two : one
  const drawn = await drawWords(pick.lines, accent, Math.max(40, pick.px), align)
  return { ...drawn, lines: pick.lines.length }
}

export interface ComposedThumb {
  jpg: Buffer
  /** The head is in front of the words. False when there was no cut-out or
   *  it would have hidden too much: the words are then in front. */
  depth: boolean
  /** Where the words went. */
  layout: 'top' | 'side' | 'front'
  /** Share of the words the head covers (0 when in front). */
  hidden: number
  crop: Crop
}

/**
 * The thumbnail: the frame (any size), the creator's cut-out of that frame
 * (same size, transparent around them) or null, and the words with the one to
 * underline. 1280 x 720 JPEG under YouTube's 2MB.
 */
export async function composeThumb(o: { still: Buffer; cutout: Buffer | null; words: string; accent: string; crop?: boolean }): Promise<ComposedThumb> {
  const { default: sharp } = await import('sharp')
  const words = o.words.replace(/\s+/g, ' ').trim()
  if (!words) throw new Error('no words for the thumbnail')
  const meta = await sharp(o.still).metadata()
  const W = meta.width ?? 0, H = meta.height ?? 0
  if (W < 640 || H < 360) throw new Error(`the frame is too small (${W}x${H})`)

  // Where the creator is, from the cut-out's own transparency.
  let personFull: Box | null = null
  let cutAlpha: Buffer | null = null
  if (o.cutout) {
    const cut = await sharp(o.cutout).resize(W, H, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
    cutAlpha = cut.data
    personFull = alphaBox(cut.data, cut.info.width, cut.info.height)
  }
  // A picture composed for the words already (the generator's) is used whole.
  const crop = o.crop === false ? cropFor(null, W, H) : cropFor(personFull, W, H)

  // The frame, brighter and a little richer, as a thumbnail is.
  const base = await sharp(o.still).extract(crop).resize(THUMB_W, THUMB_H, { fit: 'fill' })
    .modulate({ brightness: 1.05, saturation: 1.16 }).linear(1.06, -6).sharpen({ sigma: 0.8 }).removeAlpha().raw().toBuffer()
  // The creator's outline on the same window, at the same size.
  const personAlpha = personFull && cutAlpha
    // extractChannel(0): sharp writes a one channel picture back as three.
    ? await sharp(cutAlpha, { raw: { width: W, height: H, channels: 1 } }).extract(crop).resize(THUMB_W, THUMB_H, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
    : null
  const pBox = personAlpha ? alphaBox(personAlpha, THUMB_W, THUMB_H) : null

  const accent = accentIndex(words, o.accent)
  const mx = Math.round(THUMB_W * 0.04), my = Math.round(THUMB_H * 0.035)
  // The words' band ends a little into the hair, so the head overlaps them.
  const bandBottom = pBox ? Math.min(THUMB_H * 0.3, Math.max(THUMB_H * 0.2, pBox.y0 + THUMB_H * 0.07)) : THUMB_H * 0.3
  const place = async (area: { x: number; y: number; w: number; h: number }, align: 'left' | 'center' | 'right') => {
    const d = await fitWords(words, accent, area, align, Math.round(THUMB_H * 0.2))
    const x = align === 'left' ? area.x : align === 'right' ? area.x + area.w - d.width : Math.round(area.x + (area.w - d.width) / 2)
    const layer = await sharp({ create: { width: THUMB_W, height: THUMB_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: d.png, left: Math.max(0, x), top: Math.max(0, area.y) }]).png().toBuffer()
    const alpha = await sharp(layer).extractChannel(3).raw().toBuffer()
    return { layer, hidden: personAlpha ? hiddenShare(alpha, personAlpha) : 0 }
  }

  let pick: { layer: Buffer; hidden: number; layout: ComposedThumb['layout']; depth: boolean } | null = null
  const top = await place({ x: mx, y: my, w: THUMB_W - 2 * mx, h: Math.round(bandBottom - my) }, 'center')
  // The head may take a sliver of the words, as in the look, never a word.
  if (personAlpha && top.hidden <= 0.07) pick = { ...top, layout: 'top', depth: true }
  // Beside the head, on the side with more room, when that is wide enough:
  // measured on the rows the words would use, so the shoulders below do not count.
  if (!pick && personAlpha) {
    const bandH = Math.round(THUMB_H * 0.36)
    const head = alphaBox(personAlpha.subarray(my * THUMB_W, (my + bandH) * THUMB_W), THUMB_W, bandH)
    if (head) {
      const leftRoom = head.x0 - mx * 1.5, rightRoom = THUMB_W - head.x1 - mx * 1.5
      const onLeft = leftRoom >= rightRoom
      const room = Math.round(Math.max(leftRoom, rightRoom))
      if (room >= THUMB_W * 0.3) {
        const side = await place({ x: onLeft ? mx : THUMB_W - mx - room, y: my, w: room, h: bandH }, onLeft ? 'left' : 'right')
        if (side.hidden <= 0.04) pick = { ...side, layout: 'side', depth: true }
      }
    }
  }
  if (!pick) pick = { ...top, hidden: 0, layout: 'front', depth: false }

  const rgb = await sharp(base, { raw: { width: THUMB_W, height: THUMB_H, channels: 3 } }).png().toBuffer()
  const layers: { input: Buffer }[] = [{ input: pick.layer }]
  if (pick.depth && personAlpha) {
    // The creator again, from the same brightened frame, so the edges match.
    const head = await sharp(base, { raw: { width: THUMB_W, height: THUMB_H, channels: 3 } }).joinChannel(personAlpha, { raw: { width: THUMB_W, height: THUMB_H, channels: 1 } }).png().toBuffer()
    layers.push({ input: head })
  }
  const flat = sharp(rgb).composite(layers)
  let jpg = await flat.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  for (const q of [82, 74]) { if (jpg.byteLength <= 2 * 1024 * 1024) break; jpg = await flat.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer() }
  return { jpg, depth: pick.depth, layout: pick.layout, hidden: Math.round(pick.hidden * 100) / 100, crop }
}
