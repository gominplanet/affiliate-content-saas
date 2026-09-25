// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Labs features still being tested by the owner, before any Pro user sees them.
//
// ONE SWITCH PER FEATURE, IN ONE PLACE. Each new tool is shown only to admin
// until it has been tried on the live site. Opening one to Pro is a one-word
// change here, and the nav, the pages and the routes all follow it.

import { normalizeTier } from '@/lib/tier'
import { canSeeNav } from '@/lib/feature-access'

export type PreviewFeature = 'on_sale' | 'amazon_live' | 'comparison'

/** Who may use each preview feature: 'admin' while testing, 'labs' once open to Pro. */
const OPEN_TO: Record<PreviewFeature, 'admin' | 'labs'> = {
  // Encore: open to Pro, and in the Create menu since it left Labs.
  on_sale: 'labs',
  amazon_live: 'admin',
  // Co-Pilot comparison videos: 2 to 4 products in one video.
  comparison: 'admin',
}

export function canUsePreview(feature: PreviewFeature, rawTier: unknown): boolean {
  const tier = normalizeTier(rawTier)
  return OPEN_TO[feature] === 'admin' ? tier === 'admin' : canSeeNav('labs', tier)
}

export function previewOpenToPro(feature: PreviewFeature): boolean {
  return OPEN_TO[feature] === 'labs'
}
