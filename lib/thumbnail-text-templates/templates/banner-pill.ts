// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BANNER PILL — main headline above, with a coloured pill/banner under it
// holding the supporting line (call-to-action / setup / question). Matches
// the "FINALLY, PERFECT!! / [red banner] NAIL IT EVERY TIME" aesthetic.
// More editorial than Block Display; great for review-with-verdict videos.

import type { Template, TemplateInput, TemplateNode } from '../types'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input

  const colWidth = Math.round(width * 0.52)
  const padX = Math.round(width * 0.04)

  // Main headline = the punch (often two short words on two lines). Banner
  // sits underneath holding the topLine or leading as the supporting copy.
  const punchSize = Math.min(colWidth * 0.30, height * 0.32)
  const bannerTextSize = Math.round(punchSize * 0.26)
  const outlineW = Math.max(8, Math.round(punchSize * 0.07))

  // Two-line punch — Bangers font (comic-book bold) on two lines if we can
  // wrap it cleanly, otherwise single line. Simple split: take first half of
  // words on top, second half on bottom. Punch is rarely > 4 words.
  const punchWords = content.punch.trim().split(/\s+/)

  // ── Punch text layout. Three cases:
  //   1. Short punch (1-2 words): single line, FULL ACCENT colour so it pops
  //      against the white banner below. (Was previously rendering in white
  //      because the accent only applied to "line2" of a two-line split.)
  //   2. Medium punch (3-4 words): split into 2 lines, line1 = white,
  //      line2 = accent. Mirrors the DOVOH "FINALLY, / PERFECT!!" pattern.
  //   3. Long punch (5+ words): single line, accent colour, smaller (the
  //      auto-fit handles this via punchSize cap).
  const useTwoLineSplit = punchWords.length >= 3 && punchWords.length <= 4
  const splitAt = useTwoLineSplit ? Math.ceil(punchWords.length / 2) : punchWords.length
  const line1 = punchWords.slice(0, splitAt).join(' ').toUpperCase()
  const line2 = useTwoLineSplit ? punchWords.slice(splitAt).join(' ').toUpperCase() : ''

  const bannerText = (content.topLine || content.leading || '').toUpperCase()

  // ── Punch text — single accent line, OR two-line stack (white + accent).
  const headline: TemplateNode = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: side === 'left' ? 'flex-start' : 'flex-end',
        lineHeight: 0.88,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Bangers',
              fontSize: punchSize,
              // Short/long punch: full accent on the one line. Two-line split:
              // white on top so line2 reads as the emphasis.
              color: useTwoLineSplit ? palette.primary : palette.accent,
              letterSpacing: 2,
              textShadow: outline(outlineW, palette.outline),
            },
            children: line1,
          },
        },
        line2 ? {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Bangers',
              fontSize: punchSize,
              color: palette.accent,
              letterSpacing: 2,
              textShadow: outline(outlineW, palette.outline),
            },
            children: line2,
          },
        } : null,
      ].filter(Boolean),
    },
  }

  // ── Banner — coloured pill behind the supporting line. Slight tilt + drop
  // shadow makes it feel like a sticker slapped on top of the headline. Only
  // rendered when there's banner text to put inside.
  const bannerBg = palette.bannerBg || '#E50914' // canonical red if not set
  const banner: TemplateNode | null = bannerText ? {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginTop: Math.round(punchSize * 0.18),
        backgroundColor: bannerBg,
        color: palette.primary,
        fontFamily: 'Anton',
        fontSize: bannerTextSize,
        letterSpacing: 2,
        textTransform: 'uppercase',
        paddingLeft: Math.round(bannerTextSize * 0.8),
        paddingRight: Math.round(bannerTextSize * 0.8),
        paddingTop: Math.round(bannerTextSize * 0.3),
        paddingBottom: Math.round(bannerTextSize * 0.4),
        borderRadius: Math.round(bannerTextSize * 0.7),
        boxShadow: `${Math.round(outlineW * 0.4)}px ${Math.round(outlineW * 0.6)}px 0 rgba(0,0,0,0.55)`,
        transform: 'rotate(-2deg)',
      },
      children: bannerText,
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
      children: [headline, banner].filter(Boolean),
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

export const bannerPill: Template = {
  id: 'banner-pill',
  label: 'Banner Pill',
  whenToUse:
    'Headline + supporting tagline. The headline is the main statement (2-4 words on 1-2 lines), and the banner pill below holds the proof / setup / call-to-action ("NAIL IT EVERY TIME", "FROM A REAL OWNER", "AFTER 30 DAYS"). Best for verdict / review / before-after style videos.',
  fonts: ['Bangers', 'Anton'],
  render,
}
