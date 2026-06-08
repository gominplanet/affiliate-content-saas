// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DUAL COLOR STACK — clean two-line vertical split with the setup line in
// white and the payoff line in the accent colour. The most stripped-back
// designer template: no banners, no badges, no decorative shapes — just
// the contrast between line 1 (calm white) and line 2 (loud yellow).
//
// Aesthetic match: clean modern review channels, MKBHD-style restraint.

import type { Template, TemplateInput, TemplateNode } from '../types'
import { safeZone, fitStackedFontSize } from '../safe-zone'

function render(input: TemplateInput): TemplateNode {
  const { width, height, side, content, palette } = input
  const sz = safeZone(width, height)
  const colWidth = Math.round(width * 0.52)
  const textCol = colWidth - sz.hMargin

  // The two lines: setup (white) → payoff (accent). If only a punch was
  // provided, split it. Otherwise use leading/punch as the two halves.
  const top = (content.leading || '').trim()
  const bottom = (content.punch || '').trim()
  const lines = top ? [top, bottom] : [bottom]

  const fontSize = fitStackedFontSize({
    lines,
    columnInnerWidth: textCol,
    columnInnerHeight: sz.innerHeight,
    targetCeiling: Math.min(textCol * 0.36, height * 0.38),
    lineHeight: 0.92,
  })
  // Outline width = ~9% of font size. Tried 7% (too thin halo), tried 12%
  // (too blobby — text-shadow approach makes thick outlines look fat).
  // 9% is the sweet spot for the text-shadow ring approach: visible
  // against busy backgrounds but doesn't blob the letterforms.
  const outlineW = Math.max(10, Math.round(fontSize * 0.09))

  const lineNodes: TemplateNode[] = lines.map((text, i) => ({
    type: 'div',
    props: {
      style: {
        fontFamily: 'Anton',
        fontSize,
        // Top line = setup (white). Bottom line = payoff (accent).
        color: i === lines.length - 1 ? palette.accent : palette.primary,
        letterSpacing: 1,
        textTransform: 'uppercase',
        textShadow: outline(outlineW, palette.outline),
        lineHeight: 0.92,
      },
      children: text.toUpperCase(),
    },
  }))

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
            textAlign: side === 'left' ? 'left' : 'right',
            // -3° tilt = Gemini's "viral aesthetic energy" handoff (2026-06-08).
            // A small slant on the headline column is a high-CTR signal that
            // separates designed thumbnails from "templated" ones — the eye
            // reads it as more dynamic without sacrificing legibility. The
            // template renders cleanly without rotation too (Satori handles
            // the transform via CSS; resvg honours it during rasterisation).
            transform: 'rotate(-3deg)',
            // transformOrigin anchors the rotation to the corner where the
            // text actually sits — left-side text rotates around its top-left,
            // right-side text rotates around its top-right. Without this the
            // default origin (centre) pushes the text off-canvas.
            transformOrigin: side === 'left' ? 'top left' : 'top right',
          },
          children: lineNodes,
        },
      },
    },
  }
}

// Faux-stroke around the glyphs via text-shadow. Satori doesn't expose
// SVG's paint-order: stroke fill, so we simulate it: many opaque
// shadows around the perimeter PLUS a half-radius inner ring to fill
// any gaps between the cardinals. The denser ring is what makes the
// outline read as a real vector stroke instead of 8 soft shadows.
//
// 2026-06-08: bumped from 8→24 directions and added the inner ring
// after user said the previous outline looked soft vs. Gemini's
// reference. Dropped the rgba drop-shadow component that was adding
// noticeable blur — the heavier solid stroke handles depth on its own.
function outline(width: number, color: string): string {
  const w = Math.max(1, Math.round(width))
  const offsets: Array<[number, number]> = []
  // Outer ring: 24 directions at full radius for smooth perimeter coverage.
  const outerSteps = 24
  for (let i = 0; i < outerSteps; i++) {
    const a = (i * Math.PI * 2) / outerSteps
    offsets.push([Math.round(Math.cos(a) * w), Math.round(Math.sin(a) * w)])
  }
  // Inner ring: 12 directions at half radius to fill gaps inside the
  // outer ring (where straight diagonals leave triangular holes).
  const innerSteps = 12
  const wHalf = Math.round(w * 0.5)
  for (let i = 0; i < innerSteps; i++) {
    const a = (i * Math.PI * 2) / innerSteps
    offsets.push([Math.round(Math.cos(a) * wHalf), Math.round(Math.sin(a) * wHalf)])
  }
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(', ')
}

export const dualColorStack: Template = {
  id: 'dual-color-stack',
  label: 'Dual Color Stack',
  whenToUse:
    'Two-line setup/payoff headlines. Line 1 sets context ("THIS IS WHY"), line 2 delivers the emphasis ("I LOVE IT"). Cleaner than block-display, no decorative banner or badge — just the contrast between white and yellow lines. Works for almost any headline that can split naturally into setup + payoff.',
  fonts: ['Anton'],
  render,
}
