// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STAMP TILT — a rubber-stamp style verdict treatment: heavily rotated
// (~12°), thick double-border frame, bold blocky font. Reads as
// "APPROVED" / "CERTIFIED" / "AVOID" stamps on a real document. Strong
// editorial punch when the headline is a clear verdict word.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.55)
  const textCol = colWidth - sz.hMargin

  // Single emphatic line. If there's a leading + punch we render both;
  // the punch gets the stamp treatment, leading sits above smaller.
  const top = (content.leading || content.topLine || '').trim().toUpperCase()
  const stamp = content.punch.trim().toUpperCase()

  // Stamp fontSize fits within ~75% of the inner area (the frame eats some height).
  const stampSize = fitStackedFontSize({
    lines: [stamp],
    columnInnerWidth: Math.round(textCol * 0.85),
    columnInnerHeight: Math.round(sz.innerHeight * (top ? 0.6 : 0.75)),
    targetCeiling: Math.min(textCol * 0.34, height * 0.32),
    lineHeight: 1,
  })
  const topSize = Math.round(stampSize * 0.32)
  const borderW = Math.max(6, Math.round(stampSize * 0.08))
  const stampColor = palette.accent // red/yellow stamp text on a contrast frame

  const children: TemplateNode[] = []
  if (top) {
    children.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'BebasNeue',
          fontSize: topSize,
          color: palette.primary,
          letterSpacing: 2,
          textShadow: `0 ${Math.max(2, Math.round(topSize * 0.06))}px 0 ${palette.outline}`,
          marginBottom: Math.round(topSize * 0.4),
        },
        children: top,
      },
    })
  }
  // The stamp itself — double-border frame with rotated text inside.
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: Math.round(stampSize * 0.45),
        paddingRight: Math.round(stampSize * 0.45),
        paddingTop: Math.round(stampSize * 0.18),
        paddingBottom: Math.round(stampSize * 0.22),
        // Double-edge frame: outer border + inner border via boxShadow stack.
        // Outer thick line + inner thinner line + drop shadow.
        border: `${borderW}px solid ${stampColor}`,
        boxShadow: `inset 0 0 0 ${Math.round(borderW * 0.4)}px transparent, inset 0 0 0 ${Math.round(borderW * 0.6)}px ${stampColor}`,
        borderRadius: Math.round(stampSize * 0.05),
        transform: 'rotate(-10deg)',
      },
      children: {
        type: 'div',
        props: {
          style: {
            fontFamily: 'Anton',
            fontSize: stampSize,
            color: stampColor,
            letterSpacing: 4,
            lineHeight: 1,
            textShadow: `${Math.max(1, Math.round(borderW * 0.2))}px ${Math.max(1, Math.round(borderW * 0.25))}px 0 rgba(0,0,0,0.4)`,
          },
          children: stamp,
        },
      },
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
            justifyContent: input.verticalAnchor === 'bottom' ? 'flex-end' : input.verticalAnchor === 'center' ? 'center' : 'flex-start',
            alignItems: side === 'left' ? 'flex-start' : 'flex-end',
          },
          children,
        },
      },
    },
  }
}

export const stampTilt: Template = {
  id: 'stamp-tilt',
  label: 'Stamp Tilt',
  whenToUse:
    'When the punch IS a verdict word — "APPROVED", "CERTIFIED", "AVOID", "VERIFIED", "TESTED", "FIRE", "TRASH". Renders the word inside a tilted double-border frame so it reads as a rubber stamp on the photo. Best for review videos with a strong yes/no recommendation.',
  fonts: ['Anton', 'BebasNeue'],
  render,
}
