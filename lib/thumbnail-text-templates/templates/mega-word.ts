// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MEGA WORD — ONE giant power word fills the canvas + a small descriptor
// line above or below. MrBeast-style maximum-impact treatment. The punch
// becomes a poster, the rest of the headline gets demoted to caption size.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.55) // a touch wider — the mega word needs room
  const textCol = colWidth - sz.hMargin

  const megaWord = content.punch.trim().toUpperCase()
  // Caption appears smaller above the mega word, NOT below — putting it
  // above gives the mega word the visual "drop" effect.
  const caption = (content.leading || content.topLine || '').trim().toUpperCase()

  const megaSize = fitStackedFontSize({
    lines: [megaWord],
    columnInnerWidth: textCol,
    columnInnerHeight: caption ? Math.round(sz.innerHeight * 0.78) : sz.innerHeight,
    targetCeiling: Math.min(textCol * 0.55, height * 0.55),
    lineHeight: 0.88,
  })
  const captionSize = Math.round(megaSize * 0.22)
  const outlineW = Math.max(10, Math.round(megaSize * 0.075))
  const captionOutlineW = Math.max(4, Math.round(captionSize * 0.15))

  const lines: TemplateNode[] = []
  if (caption) {
    lines.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'BebasNeue',
          fontSize: captionSize,
          color: palette.primary,
          letterSpacing: 3,
          textShadow: outline(captionOutlineW, palette.outline),
          marginBottom: Math.round(captionSize * 0.3),
          lineHeight: 1,
        },
        children: caption,
      },
    })
  }
  lines.push({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Anton',
        fontSize: megaSize,
        color: palette.accent,
        letterSpacing: 0,
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.88,
      },
      children: megaWord,
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
          children: lines,
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

export const megaWord: Template = {
  id: 'mega-word',
  label: 'Mega Word',
  whenToUse:
    'When the headline can collapse to ONE explosive word: "INCREDIBLE", "TERRIBLE", "AMAZING", "FAILED", "WINNER", "FIRE". The single word fills the canvas while a small caption above provides minimal context. Avoid when the headline genuinely needs multiple words to make sense.',
  fonts: ['Anton', 'BebasNeue'],
  render,
}
