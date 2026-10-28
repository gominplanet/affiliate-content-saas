// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TEXT DRAWN AS AN IMAGE, IN AN ARIAL LOOK-ALIKE (Seb, 2026-10-28: Cloudinary
// disabled MVP's account). Cloudinary drew every caption, deal headline and
// Story label in Arial bold on a rounded box. MVP draws them itself now, in
// Arimo bold (shaped like Arial), as a tight transparent PNG ready to place:
// the overlay burner (lib/overlay-burn) and the deal pictures and Story
// images (lib/deal-images) all use this.
//
// The font ships with every API route (next.config outputFileTracingIncludes).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

let arimo: Buffer | null = null
/** Arimo bold, from node_modules/@fontsource/arimo. */
export function pillFont(): Buffer {
  if (arimo) return arimo
  const rel = path.join('@fontsource', 'arimo', 'files', 'arimo-latin-700-normal.woff')
  for (const p of [path.join(process.cwd(), 'node_modules', rel), path.join(process.cwd(), '..', 'node_modules', rel)]) {
    if (existsSync(p)) return (arimo = readFileSync(p))
  }
  throw new Error('text font not found (node_modules/@fontsource/arimo)')
}

/** Text the face can draw: Latin letters and punctuation. Emoji and other
 *  scripts are dropped, as Cloudinary's Arial layer dropped them. */
export function drawableText(text: string | null | undefined): string {
  return String(text || '').replace(/[^\x20-\x7E -ÿ]/g, '').replace(/\s{2,}/g, ' ').trim()
}

export type PillStyle = {
  fontPx: number
  color: string
  /** The box behind the text; null for text alone. */
  background?: string | null
  radius?: number
  letterSpacing?: number
  shadow?: boolean
  /** The widest the box may be before the text wraps. */
  maxWidth?: number
  /** An image drawn before the text, inside the box (an icon). */
  icon?: { src: string; width: number; height: number; gap: number } | null
  /** Space inside the box, in pixels. Defaults to a slim pill. */
  padY?: number
  padX?: number
}

/** The text drawn as a tight transparent PNG at its real size. */
export async function drawTextPill(text: string, s: PillStyle): Promise<{ png: Buffer; width: number; height: number }> {
  const [{ default: satori }, { Resvg }, { default: sharp }] = await Promise.all([import('satori'), import('@resvg/resvg-js'), import('sharp')])
  const maxWidth = s.maxWidth ?? 960
  const padY = s.padY ?? Math.round(s.fontPx * 0.18)
  const padX = s.padX ?? Math.round(s.fontPx * 0.4)
  const words = {
    type: 'div',
    props: {
      style: { display: 'flex', textAlign: 'center', justifyContent: 'center', ...(s.icon ? {} : { maxWidth: maxWidth - (s.background ? padX * 2 : 0) }) },
      children: drawableText(text),
    },
  }
  const tree = {
    type: 'div',
    props: {
      style: { display: 'flex', width: '100%', height: '100%', alignItems: 'flex-start', justifyContent: 'flex-start', padding: 24 },
      children: {
        type: 'div',
        props: {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth,
            fontFamily: 'Arimo', fontWeight: 700, fontSize: s.fontPx, lineHeight: 1.15, color: s.color,
            ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}),
            ...(s.background ? { backgroundColor: s.background, borderRadius: s.radius ?? 0, padding: `${padY}px ${padX}px` } : {}),
            ...(s.shadow ? { textShadow: '0px 4px 10px rgba(0,0,0,0.85)' } : {}),
          },
          children: s.icon
            ? [{ type: 'img', props: { src: s.icon.src, width: s.icon.width, height: s.icon.height, style: { marginRight: s.icon.gap } } }, words]
            : words,
        },
      },
    },
  }
  const W = maxWidth + 48
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(tree as any, { width: W, height: Math.max(400, Math.round(s.fontPx * 8)), fonts: [{ name: 'Arimo', data: pillFont(), weight: 700, style: 'normal' }] })
  const raw = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: 'rgba(0,0,0,0)' }).render().asPng()
  const { data, info } = await sharp(raw).trim().png().toBuffer({ resolveWithObject: true })
  return { png: data, width: info.width, height: info.height }
}
