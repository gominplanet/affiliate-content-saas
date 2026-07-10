// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Tier-specific app badge shown in the sidebar brand slot. Each badge is a
// square lockup with the M mark AND the "MVP AFFILIATE / <tier>" wordmark baked
// in — so it REPLACES both the generic mark and the title text (rendered large
// enough that its own wordmark reads).
//
// Creator, Studio, Pro and Admin each have a badge. Only Trial falls back to the
// default purple "M" + "MVP Affiliate" title, since no badge art exists for it.
// For an admin using "View as tier", the shell resolves the previewed tier so
// the badge swaps too (and shows the Admin badge when not previewing).
//
// Served as 256px webp (~17KB) rather than the 500px source PNGs (~450KB each):
// this loads on EVERY dashboard page, and 256px is 2x the 112px render so it
// stays sharp on retina. Source PNGs stay in /public/png as the master art.

import type { Tier } from '@/lib/tier'

export interface TierBadge {
  src: string
  /** Tier name as it appears in the artwork — used for the alt text. */
  label: string
}

export const TIER_BADGES: Partial<Record<Tier, TierBadge>> = {
  creator: { src: '/tier-badges/creator.webp', label: 'Creator' },
  studio: { src: '/tier-badges/studio.webp', label: 'Studio' },
  pro: { src: '/tier-badges/pro.webp', label: 'Pro' },
  admin: { src: '/tier-badges/admin.webp', label: 'Admin' },
}

/** The badge for a tier, or null when none exists (trial only). */
export function tierBadge(tier: Tier | string | null | undefined): TierBadge | null {
  if (!tier) return null
  return TIER_BADGES[tier as Tier] ?? null
}
