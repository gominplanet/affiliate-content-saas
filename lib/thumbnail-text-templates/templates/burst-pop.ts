// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BURST POP — comic-book starburst polygon with ONE power word centred
// inside. The yellow/red starburst SVG sits behind the word, creating
// the "NEW!", "INSANE!", "WOW!", "EXCLUSIVE!" sales-y energy. Best
// reserved for genuinely punchy single-word reactions; would feel
// tacky on calmer review headlines.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.50)

  const top = (content.leading || '').trim().toUpperCase()
  const power = content.punch.trim().toUpperCase()

  // Burst sits in a square area roughly half the canvas height (or
  // smaller if there's also a leading line).
  const burstAreaSide = Math.min(
    Math.round(sz.innerHeight * (top ? 0.7 : 0.85)),
    Math.round((colWidth - sz.hMargin) * 0.95),
  )

  const powerSize = fitStackedFontSize({
    lines: [power],
    // The text inside the burst sits in the inner ~55% of the burst diameter.
    columnInnerWidth: Math.round(burstAreaSide * 0.55),
    columnInnerHeight: Math.round(burstAreaSide * 0.45),
    targetCeiling: Math.round(burstAreaSide * 0.34),
    lineHeight: 1,
  })
  const topSize = Math.round(powerSize * 0.4)
  const outlineW = Math.max(6, Math.round(powerSize * 0.08))

  // 16-point starburst polygon — alternating outer + inner radius gives
  // the spiky comic shape. Centered at (50,50) inside a 100×100 viewBox.
  const burstPath = (() => {
    const pts: string[] = []
    const cx = 50, cy = 50
    const outerR = 48, innerR = 32
    const spikes = 16
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR
      const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
      pts.push(`${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`)
    }
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`
  })()

  const burstColor = palette.accent
  const innerBurstColor = '#FFFFFF' // small inner ring for double-pop effect
  const innerR = Math.round(burstAreaSide * 0.42)

  // Compose: burst SVG behind, text absolutely centred over it.
  const stack: TemplateNode = {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: burstAreaSide,
        height: burstAreaSide,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'rotate(-6deg)',
      },
      children: [
        // Outer starburst
        {
          type: 'svg',
          props: {
            width: burstAreaSide,
            height: burstAreaSide,
            viewBox: '0 0 100 100',
            fill: burstColor,
            stroke: palette.outline,
            strokeWidth: 1.5,
            strokeLinejoin: 'round',
            style: { position: 'absolute', top: 0, left: 0 },
            children: { type: 'path', props: { d: burstPath } },
          },
        },
        // Inner white circle for the "double-pop" depth
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: `${(burstAreaSide - innerR) / 2}px`,
              left: `${(burstAreaSide - innerR) / 2}px`,
              width: innerR,
              height: innerR,
              borderRadius: '50%',
              backgroundColor: innerBurstColor,
              border: `${outlineW}px solid ${palette.outline}`,
            },
          },
        },
        // Power word
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              fontFamily: 'Bangers',
              fontSize: powerSize,
              color: palette.outline,
              letterSpacing: 2,
              lineHeight: 1,
            },
            children: power,
          },
        },
      ],
    },
  }

  // Wrap with optional small caption above the burst
  const stackedChildren: TemplateNode[] = []
  if (top) {
    stackedChildren.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'BebasNeue',
          fontSize: topSize,
          color: palette.primary,
          letterSpacing: 3,
          textShadow: `0 ${Math.max(2, Math.round(topSize * 0.06))}px 0 ${palette.outline}`,
          marginBottom: Math.round(topSize * 0.4),
        },
        children: top,
      },
    })
  }
  stackedChildren.push(stack)

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
            alignItems: 'center',
          },
          children: stackedChildren,
        },
      },
    },
  }
}

export const burstPop: Template = {
  id: 'burst-pop',
  label: 'Burst Pop',
  whenToUse:
    'Comic-book starburst behind a single explosive word — "WOW!", "INSANE!", "NEW!", "EXCLUSIVE!", "BOOM!". Maximum loud-sale energy. Avoid for measured / verdict / how-to content — only use when the punch genuinely warrants a starburst.',
  fonts: ['Bangers', 'BebasNeue'],
  render,
}
