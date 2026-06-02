// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BLOCK DISPLAY — massive condensed-sans headline with a selective accent word.
// Matches the "ULTIMATE INVENTORY TOOL!" / "WORTH IT?" / "FINALLY, PERFECT!!"
// aesthetic: tall blocky letters, perfect thick black outline, white default
// fill with ONE word in bright yellow to anchor the eye. Designer-quality
// alternative to the standard MrBeast outline-only text style.

import type { Template, TemplateInput, TemplateNode } from '../types'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input

  // ── Layout: text occupies HALF the canvas on the side opposite the subject.
  // 6-8% horizontal padding inside that half so the text never touches the edge.
  const colWidth = Math.round(width * 0.5)
  const padX = Math.round(width * 0.04)
  const textCol = colWidth - padX * 2

  // Type scale — `punch` is the largest, `leading` slightly smaller, `topLine`
  // smallest. All in CSS pixels at 1280×720; Satori scales correctly.
  const punchSize = Math.min(textCol * 0.34, height * 0.34) // big but capped
  const leadingSize = punchSize * 0.78
  const topSize = Math.round(punchSize * 0.32)
  const subtitleSize = Math.round(punchSize * 0.28)

  // Outline thickness scales with type size so it reads at YouTube preview width.
  const outlineW = Math.max(8, Math.round(punchSize * 0.07))

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
        fontSize: punchSize,
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
            paddingLeft: padX,
            paddingRight: padX,
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
