// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LIGHT PALETTE THE AD PAGES FORCE, AS VARIABLES, NOT JUST CLASSES.
//
// Both paid landing pages lost their headings, and the cause was one global
// rule in app/globals.css:
//
//   h1, h2, h3, h4, h5, h6 { color: var(--text); }
//
// The ad pages are deliberately light-only: they hardcode `bg-[#FAFAF8]` and
// `text-[#1D1D1F]` on their wrapper rather than joining the app's theme. But a
// Tailwind text class on the wrapper does not beat a base-layer rule targeting
// the heading element itself, so every h1/h2/h3 took `var(--text)` instead.
//
// For a visitor whose app theme is dark, `--text` is #FAFAFA. Near-white
// headings on a near-white page. The dark bands looked perfect, which is what
// made it hard to see: white on dark is exactly right, and the two states share
// a page.
//
// On /run-your-storefront the H1 lost its whole first line, "Other tools help
// you decide.", leaving only the gradient half. The gradient spans survived
// because they paint themselves with background-clip and never read --text. So
// the page still looked designed, just missing its argument. On a page we buy
// clicks for.
//
// The fix is to redefine the variables on the wrapper, so the heading rule
// resolves to the light palette the page was drawn against. Setting --text
// alone would be enough for today's rule; the rest are here so the next global
// rule that reads a theme variable cannot reintroduce this.

import type { CSSProperties } from 'react'

/**
 * Spread onto the root element of a light-only marketing page.
 *
 * Cast because React's CSSProperties has no index signature for custom
 * properties. The values are the light-mode column of :root in globals.css.
 */
export const AD_PAGE_LIGHT = {
  '--bg': '#FAFAF8',
  '--surface': '#FFFFFF',
  '--text': '#1D1D1F',
  '--text-soft': 'rgba(0,0,0,0.62)',
  '--text-faint': 'rgba(0,0,0,0.42)',
  '--border': 'rgba(0,0,0,0.10)',
  '--accent-text': '#7C3AED',
} as unknown as CSSProperties
