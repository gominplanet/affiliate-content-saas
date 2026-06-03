// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PRICE TAG — main headline + a large price-tag sticker showing the
// product's price (or savings percentage). Designed for deal videos,
// "is it worth the money" reviews, and Amazon-style price-grounded
// content where the dollar figure IS the hook.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.52)
  const textCol = colWidth - sz.hMargin

  // The headline lives in the text column. The price tag is the badge
  // text (we reuse the badge field — picker writes the price into
  // `badge.text` and a label like "AMAZON" or "TOTAL" into `subtext`).
  const top = (content.leading || content.topLine || '').trim().toUpperCase()
  const main = content.punch.trim().toUpperCase()
  const headlineLines = top ? [top, main] : [main]

  const fontSize = fitStackedFontSize({
    lines: headlineLines,
    columnInnerWidth: textCol,
    columnInnerHeight: sz.innerHeight,
    targetCeiling: Math.min(textCol * 0.30, height * 0.34),
    lineHeight: 0.92,
  })
  const outlineW = Math.max(8, Math.round(fontSize * 0.07))

  // Price tag uses the accent palette colour as the tag body so it pops.
  // The hole + string accent is rendered separately to look like a real tag.
  const priceText = (content.badge?.text || '$??').trim()
  const priceLabel = (content.badge?.subtext || '').trim().toUpperCase()
  const priceTextSize = Math.round(Math.min(width * 0.075, height * 0.13))
  const labelSize = Math.round(priceTextSize * 0.32)
  const tagOutlineW = Math.max(4, Math.round(priceTextSize * 0.08))

  const headlineNodes: TemplateNode[] = headlineLines.map((text, i) => ({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Anton',
        fontSize,
        color: i === headlineLines.length - 1 ? palette.accent : palette.primary,
        letterSpacing: 1,
        textTransform: 'uppercase',
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.92,
      },
      children: text,
    },
  }))

  // The price tag — angled rectangle with a "punched hole" circle on the
  // hanging end. Bright accent background with thick black border.
  const tagBg = palette.bannerBg || '#E50914'
  const priceTag: TemplateNode = {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        bottom: sz.vMargin,
        [side === 'left' ? 'right' : 'left']: sz.hMargin,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: Math.round(priceTextSize * 0.12),
        transform: 'rotate(-6deg)',
      },
      children: [
        // The "hanging hole" circle on the leading edge — only when the tag
        // is on the LEFT side of the canvas, the hole sits to its LEFT to
        // suggest it's hanging from a string off-screen. Mirror for right.
        {
          type: 'div',
          props: {
            style: {
              width: Math.round(priceTextSize * 0.35),
              height: Math.round(priceTextSize * 0.35),
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              border: `${tagOutlineW}px solid #000`,
              order: side === 'left' ? 0 : 2, // hole on the outer edge
            },
          },
        },
        // The tag body
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: tagBg,
              color: '#FFFFFF',
              fontFamily: 'Anton',
              paddingLeft: Math.round(priceTextSize * 0.5),
              paddingRight: Math.round(priceTextSize * 0.5),
              paddingTop: Math.round(priceTextSize * 0.18),
              paddingBottom: Math.round(priceTextSize * 0.22),
              borderRadius: Math.round(priceTextSize * 0.1),
              boxShadow: `0 0 0 ${tagOutlineW}px #000, ${Math.round(tagOutlineW * 1.2)}px ${Math.round(tagOutlineW * 1.6)}px 0 rgba(0,0,0,0.5)`,
              order: 1,
            },
            children: [
              priceLabel ? {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'BebasNeue',
                    fontSize: labelSize,
                    color: '#FFFFFF',
                    letterSpacing: 3,
                    lineHeight: 1,
                    marginBottom: Math.round(labelSize * 0.15),
                  },
                  children: priceLabel,
                },
              } : null,
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'Anton',
                    fontSize: priceTextSize,
                    color: '#FFFFFF',
                    letterSpacing: 1,
                    lineHeight: 1,
                    textShadow: `${Math.max(2, Math.round(tagOutlineW * 0.4))}px ${Math.max(2, Math.round(tagOutlineW * 0.5))}px 0 rgba(0,0,0,0.4)`,
                  },
                  children: priceText,
                },
              },
            ].filter(Boolean),
          },
        },
      ],
    },
  }

  const textStack: TemplateNode = {
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
      children: headlineNodes,
    },
  }

  return {
    type: 'div',
    props: {
      style: {
        width, height,
        position: 'relative',
        display: 'flex',
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0)',
      },
      children: [textStack, priceTag].filter(Boolean),
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

export const priceTag: Template = {
  id: 'price-tag',
  label: 'Price Tag',
  whenToUse:
    'Deal-focused / price-grounded review videos. Headline on one side, a chunky angled price-tag sticker in the opposite corner showing the actual product price ($X.XX) or savings ("75% OFF"). Picker must populate the `badge.text` field with a price string and optionally `badge.subtext` ("ONLY", "TODAY", "AMAZON", "RETAIL").',
  fonts: ['Anton', 'BebasNeue'],
  render,
}
