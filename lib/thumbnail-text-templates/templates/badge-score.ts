// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BADGE SCORE — massive blocky headline + a corner sticker/badge with a
// score, check, or verdict. Matches the "WORTH IT? + [✓ 9/10]" aesthetic.
// Maximum-confidence look — perfect for "best of", "tested", "rated" review
// videos where there's a clear pass/fail or score the viewer needs to see.

import type { Template, TemplateInput, TemplateNode } from '../types'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input

  const colWidth = Math.round(width * 0.52)
  const padX = Math.round(width * 0.04)

  // The punch fills the text column on the text-side. The badge floats as an
  // ABSOLUTE element in the bottom corner OPPOSITE the text — mirrors the
  // canonical "WORTH IT? + corner 9/10 ✓" layout instead of stacking the
  // badge under the text (which previously crowded the composition).
  const punchSize = Math.min(colWidth * 0.42, height * 0.45)
  const outlineW = Math.max(10, Math.round(punchSize * 0.075))

  // Split punch into stacked lines (matches the WORTH / IT? composition).
  const punchWords = content.punch.trim().split(/\s+/)
  const wordLines: string[] = punchWords.length === 1
    ? [punchWords[0]]
    : punchWords.length === 2
      ? [punchWords[0], punchWords[1]]
      : [punchWords.slice(0, Math.ceil(punchWords.length / 2)).join(' '), punchWords.slice(Math.ceil(punchWords.length / 2)).join(' ')]

  const headlineLines: TemplateNode[] = wordLines.map(w => ({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Anton',
        fontSize: punchSize,
        color: palette.accent,
        letterSpacing: 2,
        textTransform: 'uppercase',
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.92,
      },
      children: w.toUpperCase(),
    },
  }))

  // ── Badge ─ bigger + bolder than v1 since it's now a dedicated corner
  // element rather than a stack child. Same shape: optional icon on the
  // left + score on the right + subtext below the score. White card with
  // hard double-border (black outline + drop shadow) so it pops off any
  // background colour the photo throws at it.
  const badgeText = content.badge?.text || ''
  const badgeSub = content.badge?.subtext || ''
  const badgeIcon = content.badge?.iconHint || null

  const badgeSize = Math.round(punchSize * 0.50) // was 0.34 — bigger so it reads as a focal point
  const badgeIconChar = badgeIcon === 'check' ? '✓' : badgeIcon === 'x' ? '✗' : badgeIcon === 'star' ? '★' : ''
  const badgeIconColor = badgeIcon === 'x' ? '#E50914' : badgeIcon === 'star' ? '#FFC700' : '#34C759'
  const badgeOutlineW = Math.max(4, Math.round(badgeSize * 0.08))

  const badge: TemplateNode | null = badgeText ? {
    type: 'div',
    props: {
      style: {
        // ABSOLUTE positioning in the BOTTOM CORNER OPPOSITE the text. If
        // text is on the left, badge sits bottom-right (over the subject
        // half); if text is on the right, badge sits bottom-left.
        position: 'absolute',
        bottom: Math.round(height * 0.08),
        [side === 'left' ? 'right' : 'left']: Math.round(width * 0.05),
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: Math.round(badgeSize * 0.28),
        backgroundColor: '#FFFFFF',
        paddingLeft: Math.round(badgeSize * 0.55),
        paddingRight: Math.round(badgeSize * 0.7),
        paddingTop: Math.round(badgeSize * 0.25),
        paddingBottom: Math.round(badgeSize * 0.3),
        borderRadius: Math.round(badgeSize * 0.22),
        // Double-edge sticker effect: hard black ring + drop shadow.
        boxShadow: `0 0 0 ${badgeOutlineW}px #000, ${Math.round(badgeOutlineW * 1.2)}px ${Math.round(badgeOutlineW * 1.6)}px 0 rgba(0,0,0,0.5)`,
        // Slight tilt — matches the "designer hand-stuck sticker" feel.
        transform: 'rotate(-3deg)',
      },
      children: [
        badgeIconChar ? {
          type: 'div',
          props: {
            style: {
              fontFamily: 'RussoOne',
              fontSize: Math.round(badgeSize * 1.2),
              color: badgeIconColor,
              lineHeight: 1,
            },
            children: badgeIconChar,
          },
        } : null,
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              lineHeight: 1,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'RussoOne',
                    fontSize: badgeSize,
                    color: '#000',
                    letterSpacing: 1,
                  },
                  children: badgeText.toUpperCase(),
                },
              },
              badgeSub ? {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'Anton',
                    fontSize: Math.round(badgeSize * 0.42),
                    color: '#444',
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    marginTop: Math.round(badgeSize * 0.15),
                  },
                  children: badgeSub,
                },
              } : null,
            ].filter(Boolean),
          },
        },
      ].filter(Boolean),
    },
  } : null

  const textStack: TemplateNode = {
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
      },
      children: headlineLines,
    },
  }

  // Outer canvas is now a relative flex container so the badge can position
  // absolutely against it. The text column takes its half; the badge floats
  // in the opposite bottom corner.
  return {
    type: 'div',
    props: {
      style: {
        width,
        height,
        position: 'relative',
        display: 'flex',
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0)',
      },
      children: [textStack, badge].filter(Boolean),
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
  const drop = `${Math.round(w * 0.4)}px ${Math.round(w * 0.6)}px 0 rgba(0,0,0,0.55)`
  return [...offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`), drop].join(', ')
}

export const badgeScore: Template = {
  id: 'badge-score',
  label: 'Badge Score',
  whenToUse:
    'When the video has a clear verdict, score, or rating to communicate (e.g. "9/10", "BUY", "SKIP", "WORTH IT", "NOT WORTH IT"). The headline asks the question or makes the statement; the badge holds the answer. Avoid when there is no scorable outcome.',
  fonts: ['Anton', 'RussoOne'],
  render,
}
