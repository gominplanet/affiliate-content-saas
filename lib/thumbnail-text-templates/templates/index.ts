// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Registry of every designer template. Add new templates here and to the
// picker's menu so the system can choose them.

import type { Template } from '../types'
import { blockDisplay } from './block-display'
import { bannerPill } from './banner-pill'
import { badgeScore } from './badge-score'
import { dualColorStack } from './dual-color-stack'
import { megaWord } from './mega-word'
import { brushHighlight } from './brush-highlight'
import { stampTilt } from './stamp-tilt'
import { arrowPointer } from './arrow-pointer'
import { burstPop } from './burst-pop'
import { priceTag } from './price-tag'

export const TEMPLATES: Template[] = [
  blockDisplay,
  bannerPill,
  badgeScore,
  dualColorStack,
  megaWord,
  brushHighlight,
  stampTilt,
  arrowPointer,
  burstPop,
  priceTag,
]

export function templateById(id: string): Template | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}

/**
 * Pick a random template — used for the live thumbnail generation flow
 * where we want variety across renders without making the user choose.
 *
 * Templates with HARD content requirements (badge-score needs a verdict,
 * price-tag needs a price, mega-word/burst-pop need a short punch) get
 * filtered out when the headline doesn't fit, so a "random" pick is
 * really "uniformly random across the templates that CAN handle this
 * headline". The picker upstream is what decides the per-headline split;
 * this just chooses which template to render with.
 */
export function randomTemplate(rng: () => number = Math.random): Template {
  // eslint-disable-next-line security/detect-object-injection
  return TEMPLATES[Math.floor(rng() * TEMPLATES.length)]
}
