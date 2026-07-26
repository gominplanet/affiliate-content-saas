// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHO SEES WHAT IN THE SIDEBAR — one declaration per gated feature.
//
// Why this file exists: nav visibility and real enforcement are separate
// systems, and they drifted. Buying Guides hid its nav entry below 500
// published posts, but that threshold only ever applied to ONE of its two
// paths — so paying Pro users under the threshold lost the whole feature,
// including the path with no threshold at all. Nobody noticed until a
// customer asked why she couldn't reach a page she was paying for
// (2026-07-20).
//
// The rule this encodes: THE NAV IS A HINT, THE ROUTE IS THE LAW.
//
//   • `tiers` decides whether the sidebar entry renders. Tier only — never
//     post counts, connection state, or anything else that can be stale or
//     platform-dependent. A nav entry that vanishes teaches the user the
//     feature doesn't exist; an in-page lock can explain itself.
//   • `enforcedBy` names the route that ACTUALLY gates the feature. That
//     route is the security boundary. This table is not.
//   • `extraLocks` documents any further restriction the FEATURE applies
//     once you're inside, so the next person can see at a glance that the
//     nav is deliberately more permissive than the deepest gate.
//
// When you add a gated feature: add it here, point `enforcedBy` at the
// route, and confirm that route independently checks tier. If the two
// disagree, the route wins and the nav is the bug.

import type { Tier } from '@/lib/tier'

const PAID = ['creator', 'studio', 'pro', 'admin'] as const
const PRO = ['pro', 'admin'] as const
const STUDIO_UP = ['studio', 'pro', 'admin'] as const

export interface NavAccessRule {
  /** Sidebar label, so this table reads like the menu it controls. */
  label: string
  /** Tiers that see the entry. Tier ONLY — see the note above. */
  tiers: readonly Tier[]
  /** The route that is the real gate. This table is not security. */
  enforcedBy: string
  /** Any further limit applied INSIDE the feature, once reached. */
  extraLocks?: string
}

export const NAV_ACCESS = {
  buyingGuides: {
    label: 'Buying Guides',
    tiers: PRO,
    enforcedBy: 'POST /api/buying-guides (tier + threshold + spend + quota)',
    // The 500-post rule belongs to the catalogue path only. "Paste 2-10
    // YouTube URLs" runs through /api/blog/comparison, which is Pro-gated
    // with NO threshold and works on day one. Gating the nav on post count
    // is what took that second path away.
    extraLocks: 'Catalogue path needs 500+ published posts; manual URL path has no threshold',
  },
  deals: {
    label: 'Deals Hub',
    tiers: STUDIO_UP,
    enforcedBy: 'POST /api/deals',
    extraLocks: 'Globally paused via DEALS_HUB_PAUSED in lib/deal-occasion.ts',
  },
  burner: {
    label: 'Shop Burner',
    tiers: PRO,
    enforcedBy: 'POST /api/instagram/burn + /api/instagram/burn-batch',
  },
  finders: {
    label: 'Source & Earn (AMZ Finder, Levanta, PartnerBoost, LTK, Launch Kit)',
    tiers: PAID,
    // Named concretely so scripts/test-feature-access.mjs can verify these
    // rather than shrug at prose. All three call tierAllowsFinders().
    enforcedBy: '/api/campaigns/catalog-search + /api/levanta/finder + /api/partnerboost/finder',
  },
  labs: {
    label: 'Labs (Instagram Auto-DM)',
    tiers: PRO,
    enforcedBy: 'POST /api/instagram/dm-campaign',
    extraLocks: 'Dormant until Meta approves manage_comments / manage_messages',
  },
  dealRadar: {
    label: 'Amazon Deal Radar',
    tiers: PRO,
    enforcedBy: 'GET /api/deal-radar',
    extraLocks: 'Labs while testing: admin-only until NEXT_PUBLIC_DEAL_RADAR_ENABLED=true',
  },
} as const satisfies Record<string, NavAccessRule>

export type FeatureKey = keyof typeof NAV_ACCESS

/** Does this tier see the sidebar entry for `feature`? */
export function canSeeNav(feature: FeatureKey, tier: Tier | null | undefined): boolean {
  if (!tier) return false
  return (NAV_ACCESS[feature].tiers as readonly Tier[]).includes(tier)
}
