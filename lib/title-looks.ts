// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TITLE LOOKS FOR THE REVIEW EDITOR (Seb, 2026-10-30: "let's talk about
// different fonts, different ways to write those titles"). Each look is a
// font MVP already ships (@fontsource, drawn with satori like every text MVP
// burns) with its own treatment: a box, an outline, a shadow. The creator
// picks a look, a colour and a size (lib/review-edit); this draws it as a
// tight transparent PNG the video server lays over the video, and the page
// shows that same picture as its preview, so what is seen is what is made.
//
// The fonts ship with the routes that draw titles (next.config
// outputFileTracingIncludes).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drawableText } from '@/lib/text-pill'
import { TITLE_COLORS, TITLE_PX, type LogoSize, type Position, type TitleColor, type TitleLook } from '@/lib/review-edit'

interface Font { name: string; pkg: string; file: string; weight: 400 | 700 }
export const TITLE_FONTS = {
  arimo: { name: 'Arimo', pkg: 'arimo', file: 'arimo-latin-700-normal.woff', weight: 700 },
  anton: { name: 'Anton', pkg: 'anton', file: 'anton-latin-400-normal.woff', weight: 400 },
  bebas: { name: 'Bebas Neue', pkg: 'bebas-neue', file: 'bebas-neue-latin-400-normal.woff', weight: 400 },
  marker: { name: 'Permanent Marker', pkg: 'permanent-marker', file: 'permanent-marker-latin-400-normal.woff', weight: 400 },
  russo: { name: 'Russo One', pkg: 'russo-one', file: 'russo-one-latin-400-normal.woff', weight: 400 },
  bangers: { name: 'Bangers', pkg: 'bangers', file: 'bangers-latin-400-normal.woff', weight: 400 },
} satisfies Record<string, Font>
type FontKey = keyof typeof TITLE_FONTS

const loaded = new Map<string, Buffer>()
function fontData(f: Font): Buffer {
  const hit = loaded.get(f.pkg)
  if (hit) return hit
  for (const base of [process.cwd(), join(process.cwd(), '..')]) {
    const p = join(base, 'node_modules', '@fontsource', f.pkg, 'files', f.file)
    if (existsSync(p)) { const d = readFileSync(p); loaded.set(f.pkg, d); return d }
  }
  throw new Error(`title font ${f.name} not found (node_modules/@fontsource/${f.pkg})`)
}

interface Spec { font: FontKey; upper: boolean; scale: number; letterSpacing?: number; box: boolean; radius?: number; outline?: boolean; shadow?: boolean }
const SPEC: Record<TitleLook, Spec> = {
  clean: { font: 'arimo', upper: false, scale: 1, box: true, radius: 18 },
  bold: { font: 'anton', upper: true, scale: 1.3, box: false, outline: true, shadow: true, letterSpacing: 1 },
  caps: { font: 'bebas', upper: true, scale: 1.45, box: false, shadow: true, letterSpacing: 3 },
  highlight: { font: 'arimo', upper: false, scale: 1, box: true, radius: 4 },
  marker: { font: 'marker', upper: false, scale: 1.1, box: false, shadow: true },
  tech: { font: 'russo', upper: true, scale: 0.95, box: true, radius: 10 },
  fun: { font: 'bangers', upper: true, scale: 1.35, box: false, outline: true, letterSpacing: 2 },
}

/** Black or white, whichever reads on a colour. Pure. */
export function inkOn(hex: string): '#111111' | '#FFFFFF' {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#FFFFFF'
}

/** What a look and a colour come to: the font, the text's colour, the box's,
 *  the edge round the letters. A boxed look takes the colour as its box and
 *  the text in black or white, whichever reads; the clean look in white keeps
 *  MVP's first title, white on a dark see-through box. Pure. */
export function titleStyle(look: TitleLook, color: TitleColor) {
  const spec = SPEC[look] ?? SPEC.clean
  const hex = TITLE_COLORS[color] ?? '#FFFFFF'
  const plainClean = look === 'clean' && color === 'white'
  const box = spec.box ? (plainClean ? '#000000' : hex) : null
  const text = spec.box ? (plainClean ? '#FFFFFF' : inkOn(hex)) : hex
  // The edge and the shadow are the opposite of the text, so dark text
  // still reads on a dark video.
  const edge = inkOn(text) === '#111111' ? '#000000' : '#FFFFFF'
  return {
    font: TITLE_FONTS[spec.font], upper: spec.upper, scale: spec.scale, letterSpacing: spec.letterSpacing ?? 0,
    box, boxAlpha: plainClean ? 0.62 : 1, radius: spec.radius ?? 0, text,
    outline: spec.outline ? edge : null,
    shadow: spec.shadow ? (edge === '#000000' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)') : null,
  }
}

const ALIGN: Record<Position, 'left' | 'center' | 'right'> = {
  'upper-left': 'left', 'lower-left': 'left', 'upper-right': 'right', 'lower-right': 'right', top: 'center', bottom: 'center',
}
/** The widest a title is drawn, on a 1920 wide frame, before it wraps. */
const MAX_WIDTH = 1500

/** The title as a tight transparent PNG, drawn for a 1920 wide frame. A
 *  title too long for one line is wrapped into even lines, so no word is
 *  left alone on the last one; text in a corner lines up with that side; a
 *  box fits the words, never the widest a line could be. */
export async function drawTitle(text: string, o: { look?: TitleLook; color?: TitleColor; size?: LogoSize; position?: Position } = {}): Promise<{ png: Buffer; width: number; height: number }> {
  const words0 = drawableText(text)
  if (!words0) throw new Error('no text to draw')
  const [{ default: satori }, { Resvg }, { default: sharp }] = await Promise.all([import('satori'), import('@resvg/resvg-js'), import('sharp')])
  const st = titleStyle(o.look ?? 'clean', o.color ?? 'white')
  const px = Math.round((TITLE_PX[o.size ?? 'medium'] ?? 64) * st.scale)
  const align = ALIGN[o.position ?? 'top'] ?? 'center'
  const padY = Math.round(px * 0.3)
  const padX = Math.round(px * 0.45)
  const room = MAX_WIDTH - (st.box ? padX * 2 : 0)
  const edge = 30
  const words = st.upper ? words0.toUpperCase() : words0
  // The letters alone, trimmed to what is drawn.
  const letters = async (wrapAt: number | null) => {
    const W = (wrapAt ?? 8000) + edge * 2
    const tree = {
      type: 'div',
      props: {
        style: { display: 'flex', width: '100%', height: '100%', alignItems: 'flex-start', justifyContent: 'flex-start', padding: edge },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex', textAlign: align, ...(wrapAt ? { width: wrapAt } : { whiteSpace: 'nowrap' }),
              justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
              fontFamily: st.font.name, fontWeight: st.font.weight, fontSize: px, lineHeight: 1.12, color: st.text,
              ...(st.letterSpacing ? { letterSpacing: st.letterSpacing } : {}),
              ...(st.outline ? { WebkitTextStroke: `${Math.max(3, Math.round(px * 0.06))}px ${st.outline}` } : {}),
              ...(st.shadow ? { textShadow: `0px 5px 14px ${st.shadow}` } : {}),
            },
            children: words,
          },
        },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svg = await satori(tree as any, { width: W, height: Math.max(480, px * 7), fonts: [{ name: st.font.name, data: fontData(st.font), weight: st.font.weight, style: 'normal' }] })
    const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: 'rgba(0,0,0,0)' }).render().asPng()
    return sharp(raw).trim().png().toBuffer({ resolveWithObject: true })
  }
  let drawn = await letters(null)
  if (drawn.info.width > room) {
    // Even lines: the one-line width shared out, with room for whole words.
    const lines = Math.ceil(drawn.info.width / room)
    drawn = await letters(Math.min(room, Math.ceil((drawn.info.width / lines) * 1.12 + px)))
  }
  if (!st.box) return { png: drawn.data, width: drawn.info.width, height: drawn.info.height }
  const bw = drawn.info.width + padX * 2, bh = drawn.info.height + padY * 2
  const r = Math.min(st.radius, Math.floor(bh / 2))
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}"><rect width="${bw}" height="${bh}" rx="${r}" ry="${r}" fill="${st.box}" fill-opacity="${st.boxAlpha}"/></svg>`)
  const png = await sharp(plate).composite([{ input: drawn.data, left: padX, top: padY }]).png().toBuffer()
  return { png, width: bw, height: bh }
}
