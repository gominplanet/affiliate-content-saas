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

  // The punch is the dominant element — even bigger than block-display
  // since the score badge picks up the supporting context. Two-line wrap
  // for headlines like "WORTH IT?" (often 2-3 words split across 2 lines).
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

  // ── Badge — small sticker in the bottom-OPPOSITE-of-side corner. Holds
  // the score / verdict so the viewer can read it without parsing the
  // headline. White background, dark text, green checkmark, drop shadow.
  const badgeText = content.badge?.text || ''
  const badgeSub = content.badge?.subtext || ''
  const badgeIcon = content.badge?.iconHint || null

  const badgeSize = Math.round(punchSize * 0.34)
  const badgeIconChar = badgeIcon === 'check' ? '✓' : badgeIcon === 'x' ? '✗' : badgeIcon === 'star' ? '★' : ''
  const badgeIconColor = badgeIcon === 'x' ? '#E50914' : badgeIcon === 'star' ? '#FFC700' : '#34C759'

  const badge: TemplateNode | null = badgeText ? {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: Math.round(badgeSize * 0.25),
        marginTop: Math.round(punchSize * 0.18),
        backgroundColor: '#FFFFFF',
        paddingLeft: Math.round(badgeSize * 0.5),
        paddingRight: Math.round(badgeSize * 0.7),
        paddingTop: Math.round(badgeSize * 0.2),
        paddingBottom: Math.round(badgeSize * 0.25),
        borderRadius: Math.round(badgeSize * 0.25),
        boxShadow: `${Math.round(outlineW * 0.4)}px ${Math.round(outlineW * 0.6)}px 0 rgba(0,0,0,0.55), 0 0 0 ${Math.round(outlineW * 0.4)}px #000`,
      },
      children: [
        badgeIconChar ? {
          type: 'div',
          props: {
            style: {
              fontFamily: 'RussoOne',
              fontSize: Math.round(badgeSize * 1.1),
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
                    fontSize: Math.round(badgeSize * 0.45),
                    color: '#444',
                    letterSpacing: 1,
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

  const stack: TemplateNode = {
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
      children: [...headlineLines, badge].filter(Boolean),
    },
  }

  return {
    type: 'div',
    props: {
      style: {
        width,
        height,
        display: 'flex',
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0)',
      },
      children: stack,
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
