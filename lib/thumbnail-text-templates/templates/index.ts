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

/** Templates that require explicit, verifiable data (a real price, a real
 *  score) and would HALLUCINATE that data if invoked without it. Excluded
 *  from the random pool — they're only picked when the caller passes the
 *  required data directly. price-tag was producing fake "$29.99 AMAZON"
 *  stickers on headlines like "Bug Bite Scratch Relief?" — that's exactly
 *  what this exclusion list prevents. */
const RANDOM_POOL_EXCLUSIONS: Set<string> = new Set([
  'price-tag', // would fabricate a price if no real one was provided
])

export function templateById(id: string): Template | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}

/**
 * Pick a random template — used for the live thumbnail generation flow
 * where we want variety across renders without making the user choose.
 *
 * Excludes templates that would have to fabricate data (price-tag without
 * a real price). All other templates can synthesize their accessory
 * content (badges, taglines, etc.) from the headline + product context
 * without inventing a falsifiable claim.
 */
export function randomTemplate(rng: () => number = Math.random): Template {
  const pool = TEMPLATES.filter(t => !RANDOM_POOL_EXCLUSIONS.has(t.id))
  // eslint-disable-next-line security/detect-object-injection
  return pool[Math.floor(rng() * pool.length)]
}
