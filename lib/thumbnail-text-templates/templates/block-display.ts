// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BLOCK DISPLAY — massive condensed-sans headline with a selective accent word.
// Matches the "ULTIMATE INVENTORY TOOL!" / "WORTH IT?" / "FINALLY, PERFECT!!"
// aesthetic: tall blocky letters, perfect thick black outline, white default
// fill with ONE word in bright yellow to anchor the eye. Designer-quality
// alternative to the standard MrBeast outline-only text style.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input

  // ── Layout: text occupies HALF the canvas on the side opposite the subject.
  // Safe-zone inset from every canvas edge so the text never bleeds close to
  // a border (mobile auto-crop + YouTube duration overlay protection).
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.5)
  // Text-area inner width = column width minus the safe-zone left margin.
  // (The other side of the column hits the visual midline, no margin needed.)
  const textCol = colWidth - sz.hMargin

  // Auto-fit punch size based on its content AND the available height. We
  // estimate which lines will render — punch may stack on its own line if
  // there's also a leading line, otherwise it can use the full text-area.
  const linesForFit = [content.leading || '', content.punch, content.subtitle || ''].filter(Boolean)
  const punchSize = fitStackedFontSize({
    lines: [content.punch],            // size the punch against its own width
    columnInnerWidth: textCol,
    columnInnerHeight: sz.innerHeight, // total stack must fit innerHeight
    targetCeiling: Math.min(textCol * 0.34, height * 0.34),
  })
  // Cap so the smaller secondary lines don't push the total stack out.
  const stackFit = fitStackedFontSize({
    lines: linesForFit,
    columnInnerWidth: textCol,
    columnInnerHeight: sz.innerHeight,
    targetCeiling: punchSize,
    lineHeight: 1.1, // slightly looser when there's >1 line type
  })
  const finalPunchSize = Math.min(punchSize, stackFit)
  const leadingSize = finalPunchSize * 0.78
  const topSize = Math.round(finalPunchSize * 0.32)
  const subtitleSize = Math.round(finalPunchSize * 0.28)

  // Outline thickness scales with type size so it reads at YouTube preview width.
  const outlineW = Math.max(8, Math.round(finalPunchSize * 0.07))

  // ── Composition. Single column, vertically centred, stacked top→bottom:
  //   [topLine?]  [leading?]  [PUNCH]  [subtitle?]
  // Punch is the visual anchor; everything else hugs it tight (low line height).
  const lines: TemplateNode[] = []
  if (content.topLine) {
    lines.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'BebasNeue',
          fontSize: topSize,
          color: palette.primary,
          letterSpacing: 2,
          textTransform: 'uppercase',
          // Text-stroke equivalent: layered text-shadow gives a thick crisp outline
          textShadow: outline(outlineW * 0.5, palette.outline),
          marginBottom: Math.round(topSize * 0.15),
          lineHeight: 1,
        },
        children: content.topLine.toUpperCase(),
      },
    })
  }
  if (content.leading) {
    lines.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'Anton',
          fontSize: leadingSize,
          color: palette.primary,
          letterSpacing: 1,
          textTransform: 'uppercase',
          textShadow: outline(outlineW, palette.outline),
          lineHeight: 0.92,
          marginBottom: 0,
        },
        children: content.leading.toUpperCase(),
      },
    })
  }
  lines.push({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Anton',
        fontSize: finalPunchSize,
        color: palette.accent,
        letterSpacing: 1,
        textTransform: 'uppercase',
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.92,
        // Slight tilt — matches the "designer hand-stuck sticker" feel
        transform: 'rotate(-1.5deg)',
      },
      children: content.punch.toUpperCase(),
    },
  })
  if (content.subtitle) {
    lines.push({
      type: 'div',
      props: {
        style: {
          fontFamily: 'BebasNeue',
          fontSize: subtitleSize,
          color: palette.primary,
          letterSpacing: 2,
          textTransform: 'uppercase',
          textShadow: outline(outlineW * 0.6, palette.outline),
          marginTop: Math.round(subtitleSize * 0.2),
          lineHeight: 1,
        },
        children: content.subtitle.toUpperCase(),
      },
    })
  }

  return {
    type: 'div',
    props: {
      style: {
        width,
        height,
        display: 'flex',
        // Place the text column on the chosen side. The OTHER side is
        // transparent so the base thumbnail shows through unobstructed.
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        // The Satori canvas itself is fully transparent — we only render text.
        backgroundColor: 'rgba(0,0,0,0)',
      },
      children: {
        type: 'div',
        props: {
          style: {
            width: colWidth,
            height,
            // Safe-zone insets: the text column's outer edge sits against
            // the canvas border (no padding there) but the INNER edge against
            // the subject side stays well clear. The top/bottom safe margins
            // prevent vertical overflow even with deep stacks.
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

/**
 * Generate a text-shadow value that simulates a thick stroke around the text.
 * Real text-stroke is CSS-only and Satori doesn't implement it, so we layer
 * 8 offset shadows in a ring pattern to fake it. Works for any colour.
 */
function outline(width: number, color: string): string {
  const w = Math.max(1, Math.round(width))
  const offsets: Array<[number, number]> = []
  // 8-direction ring at full width
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    offsets.push([Math.round(Math.cos(a) * w), Math.round(Math.sin(a) * w)])
  }
  // Plus a softer hard shadow to give the "lifted off the page" depth
  const drop = `${Math.round(w * 0.4)}px ${Math.round(w * 0.6)}px 0 rgba(0,0,0,0.55)`
  return [...offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`), drop].join(', ')
}

export const blockDisplay: Template = {
  id: 'block-display',
  label: 'Block Display',
  whenToUse:
    'Default high-impact look. Best when the headline is short (3-6 words) and there is one obvious "punch" word that should pop. Works for review, comparison, verdict, and how-to videos. Avoid when the headline is longer than 8 words.',
  fonts: ['Anton', 'BebasNeue'],
  render,
}
