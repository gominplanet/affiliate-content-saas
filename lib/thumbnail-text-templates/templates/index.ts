// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Registry of every designer template. Add new templates here and to the
// picker's menu so the system can choose them.

import type { Template } from '../types'
import { blockDisplay } from './block-display'
import { bannerPill } from './banner-pill'
import { badgeScore } from './badge-score'

export const TEMPLATES: Template[] = [
  blockDisplay,
  bannerPill,
  badgeScore,
]

export function templateById(id: string): Template | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}
