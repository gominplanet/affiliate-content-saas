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

  // Split punch into stacked lines (matches the WORTH / IT? composition).
  const punchWords = content.punch.trim().split(/\s+/)
  const wordLines: string[] = punchWords.length === 1
    ? [punchWords[0]]
    : punchWords.length === 2
      ? [punchWords[0], punchWords[1]]
      : [punchWords.slice(0, Math.ceil(punchWords.length / 2)).join(' '), punchWords.slice(Math.ceil(punchWords.length / 2)).join(' ')]

  // The punch fills the text column. The badge floats absolute in the
  // opposite corner. Mirrors the canonical "WORTH IT? + corner 9/10 ✓".
  //
  // AUTO-FIT punch size to the longest line's character count so a wide
  // 3-word punch like "TASTY OR NOT?" doesn't wrap to a third line and
  // overflow the canvas vertically. Anton glyph width ≈ 0.55× its font
  // size, so max fontSize for a line of N chars = colInnerWidth / (N * 0.55).
  // We also cap by colWidth and height fractions so the punch never grows
  // grotesquely large for very short headlines.
  const colInner = colWidth - padX * 2
  const longestLineChars = Math.max(1, ...wordLines.map(l => l.length))
  const fitFontSize = colInner / (longestLineChars * 0.55)
  // Lower the visual ceiling vs the v1 numbers — 0.30 ratio matches the
  // type scale in the original WORTH IT? reference (badge-score is meant
  // to share the canvas with a corner badge, so the headline shouldn't be
  // a full-canvas block).
  const punchSize = Math.min(colWidth * 0.30, height * 0.40, fitFontSize)
  const outlineW = Math.max(10, Math.round(punchSize * 0.075))

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

  // Badge sized at 0.55× punch (the punch itself is smaller now thanks to
  // the auto-fit + lower visual ceiling, so the badge scales relative to it
  // for visual balance). Also clamped to a fixed canvas-fraction max so a
  // tiny headline doesn't produce a microscopic badge.
  const badgeSize = Math.max(
    Math.round(width * 0.045),  // floor: ~58px on 1280 — readable at YouTube preview size
    Math.min(
      Math.round(punchSize * 0.55),
      Math.round(width * 0.08), // ceiling: ~102px on 1280 — matches the "WORTH IT?" reference
    ),
  )
  const badgeIconColor = badgeIcon === 'x' ? '#E50914' : badgeIcon === 'star' ? '#FFC700' : '#34C759'
  const badgeOutlineW = Math.max(4, Math.round(badgeSize * 0.08))
  const iconSize = Math.round(badgeSize * 1.3)

  // Inline SVG icon paths — bulletproof rendering vs Unicode glyphs (the
  // display fonts we ship don't include the ✓/✗/★ codepoints, so the
  // previous font-based icon vanished silently).
  const ICON_PATHS: Record<string, string> = {
    check: 'M5 13l4 4L19 7',                                        // checkmark
    x: 'M6 6l12 12M18 6L6 18',                                      // cross
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  }
  const iconPath = badgeIcon && ICON_PATHS[badgeIcon] ? ICON_PATHS[badgeIcon] : null
  const iconStrokeW = badgeIcon === 'star' ? 0 : 3
  const iconFill = badgeIcon === 'star' ? badgeIconColor : 'none'

  const iconNode: TemplateNode | null = iconPath ? {
    type: 'svg',
    props: {
      // viewBox on the SVG element + an icon-sized width/height gives us a
      // resolution-independent glyph that always sits the same size next to
      // the badge text regardless of badge scale.
      width: iconSize,
      height: iconSize,
      viewBox: '0 0 24 24',
      fill: iconFill,
      stroke: badgeIconColor,
      strokeWidth: iconStrokeW,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      children: { type: 'path', props: { d: iconPath } },
    },
  } : null

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
        gap: Math.round(badgeSize * 0.3),
        backgroundColor: '#FFFFFF',
        paddingLeft: Math.round(badgeSize * 0.55),
        paddingRight: Math.round(badgeSize * 0.65),
        paddingTop: Math.round(badgeSize * 0.28),
        paddingBottom: Math.round(badgeSize * 0.32),
        borderRadius: Math.round(badgeSize * 0.22),
        // Double-edge sticker effect: hard black ring + drop shadow.
        boxShadow: `0 0 0 ${badgeOutlineW}px #000, ${Math.round(badgeOutlineW * 1.2)}px ${Math.round(badgeOutlineW * 1.6)}px 0 rgba(0,0,0,0.5)`,
        // Slight tilt — matches the "designer hand-stuck sticker" feel.
        transform: 'rotate(-3deg)',
      },
      children: [
        iconNode,
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
