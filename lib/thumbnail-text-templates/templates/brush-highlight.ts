// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BRUSH HIGHLIGHT — handwritten brush-marker headline with a coloured
// highlight rectangle behind ONE word (the punch). Mixed fonts:
// Permanent Marker for the headline + an arrow-style accent. Matches
// the editorial / lifestyle "TINY TOOL, BIG CURLS!" aesthetic where
// the design feels hand-applied rather than typeset.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.52)
  const textCol = colWidth - sz.hMargin

  // Two-line layout: leading (white) on top, punch (highlighted) below.
  const top = (content.leading || '').trim().toUpperCase()
  const bottom = content.punch.trim().toUpperCase()
  const lines = top ? [top, bottom] : [bottom]

  const fontSize = fitStackedFontSize({
    lines,
    columnInnerWidth: textCol,
    columnInnerHeight: sz.innerHeight,
    targetCeiling: Math.min(textCol * 0.34, height * 0.36),
    lineHeight: 0.95,
  })
  const outlineW = Math.max(8, Math.round(fontSize * 0.07))

  // Pink/magenta highlight pill — matches the "TINY TOOL / BIG CURLS" example.
  // The bottom line text sits ON the highlight in white for max contrast.
  const highlightBg = palette.bannerBg || '#EC4899'

  const lineNodes: TemplateNode[] = []
  if (top) {
    lineNodes.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'PermanentMarker',
          fontSize,
          color: palette.primary,
          letterSpacing: 1,
          textShadow: outline(outlineW, palette.outline),
          lineHeight: 0.95,
          marginBottom: Math.round(fontSize * 0.08),
        },
        children: top,
      },
    })
  }
  // The punch line: text wrapped in a coloured highlight bar that reads
  // as if it was painted on by hand. The text itself is in white so it
  // pops against the highlight regardless of the underlying photo.
  lineNodes.push({
    type: 'div',
    props: {
      style: {
        fontFamily: 'PermanentMarker',
        fontSize,
        color: '#FFFFFF',
        letterSpacing: 1,
        lineHeight: 0.95,
        backgroundColor: highlightBg,
        paddingLeft: Math.round(fontSize * 0.18),
        paddingRight: Math.round(fontSize * 0.22),
        paddingTop: Math.round(fontSize * 0.05),
        paddingBottom: Math.round(fontSize * 0.10),
        borderRadius: Math.round(fontSize * 0.10),
        boxShadow: `${Math.round(outlineW * 0.4)}px ${Math.round(outlineW * 0.6)}px 0 rgba(0,0,0,0.5)`,
        // Slight tilt makes the highlight read like a hand-painted swipe.
        transform: 'rotate(-2deg)',
      },
      children: bottom,
    },
  })

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
            textAlign: side === 'left' ? 'left' : 'right',
          },
          children: lineNodes,
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

export const brushHighlight: Template = {
  id: 'brush-highlight',
  label: 'Brush Highlight',
  whenToUse:
    'Editorial / lifestyle vibe — Permanent Marker handwritten font with a coloured highlight pill behind the punch line. Best for beauty, lifestyle, home, and product-personality reviews where a "designed-by-hand" look beats a corporate block. Avoid for serious "verdict" or technical content.',
  fonts: ['PermanentMarker'],
  render,
}
