// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ARROW POINTER — text on one side + a hand-drawn arrow pointing
// toward the subject on the other side. Matches the "TINY TOOL → [subject]"
// aesthetic where the design literally directs the viewer's eye at what
// matters in the photo. The arrow is rendered as inline SVG so it scales
// crisply and follows the palette.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.50)
  const textCol = colWidth - sz.hMargin

  const top = (content.leading || '').trim().toUpperCase()
  const punch = content.punch.trim().toUpperCase()
  const lines = top ? [top, punch] : [punch]

  const fontSize = fitStackedFontSize({
    lines,
    columnInnerWidth: textCol,
    columnInnerHeight: Math.round(sz.innerHeight * 0.85), // leave room for arrow below
    targetCeiling: Math.min(textCol * 0.32, height * 0.32),
    lineHeight: 0.95,
  })
  const outlineW = Math.max(8, Math.round(fontSize * 0.07))

  // Arrow size relative to the headline so they feel proportional.
  const arrowSize = Math.round(fontSize * 1.4)

  const textLines: TemplateNode[] = lines.map((text, i) => ({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Bangers',
        fontSize,
        color: i === lines.length - 1 ? palette.accent : palette.primary,
        letterSpacing: 2,
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.95,
      },
      children: text,
    },
  }))

  // Hand-drawn-style arrow as inline SVG. Curved path with arrowhead.
  // When text is on the left, arrow points right (→). On the right, flip.
  const arrowPath = side === 'left'
    ? 'M 5 35 Q 30 5 60 25 L 70 18 L 65 32 L 78 28 Z'   // left-to-right curved arrow
    : 'M 75 35 Q 50 5 20 25 L 10 18 L 15 32 L 2 28 Z'   // right-to-left curved arrow

  const arrowNode: TemplateNode = {
    type: 'svg',
    props: {
      width: arrowSize,
      height: Math.round(arrowSize * 0.5),
      viewBox: '0 0 80 40',
      fill: palette.accent,
      stroke: palette.outline,
      strokeWidth: 3,
      strokeLinejoin: 'round',
      // Slight rotation gives the arrow a sketchy hand-drawn feel.
      style: { transform: 'rotate(8deg)', marginTop: Math.round(fontSize * 0.15) },
      children: { type: 'path', props: { d: arrowPath } },
    },
  }

  return {
    type: 'div',
    props: {
      style: { width, height, display: 'flex', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0)' },
      children: {
        type: 'div',
        props: {
          style: {
            width: colWidth,
            height,
            paddingLeft: side === 'left' ? sz.hMargin : Math.round(sz.hMargin * 0.5),
            paddingRight: side === 'right' ? sz.hMargin : Math.round(sz.hMargin * 0.5),
            paddingTop: sz.vMargin,
            paddingBottom: sz.vMargin,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: side === 'left' ? 'flex-start' : 'flex-end',
          },
          children: [...textLines, arrowNode],
        },
      },
    },
  }
}

function outline(width: number, color: string): string {
  const w = Math.max(1, Math.round(width))
  const offsets: Array<[number, number]> = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    offsets.push([Math.round(Math.cos(a) * w), Math.round(Math.sin(a) * w)])
  }
  return [...offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`), `${Math.round(w * 0.4)}px ${Math.round(w * 0.6)}px 0 rgba(0,0,0,0.55)`].join(', ')
}

export const arrowPointer: Template = {
  id: 'arrow-pointer',
  label: 'Arrow Pointer',
  whenToUse:
    'When the design should literally point the viewer at the subject in the photo. Text on the OPPOSITE side, hand-drawn arrow flowing toward the product/face. Works for "LOOK AT THIS" / showcase / unboxing-style energy where the punch refers to what is in the picture.',
  fonts: ['Bangers'],
  render,
}
