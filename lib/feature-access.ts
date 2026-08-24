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

// 'amazon' belongs in PAID: it's a paid plan whose whole pitch is Amazon
// product research, Deal Radar, Link in Bio and product-post publishing — all of
// which gate on canUseDealRadar()/the finders list below. Leaving it out 403'd
// Amazon subscribers on features they were sold (2026-08-13).
const PAID = ['creator', 'amazon', 'studio', 'pro', 'admin'] as const
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
    label: 'Paid finders (LTK, Social Launch Kit)',
    tiers: PAID,
    // The Levanta + PartnerBoost FINDERS and AMZ Research are now OPEN to every
    // tier (they search the user's own connected account / free Amazon catalog),
    // so they're no longer enforced here — turning a find into a published post
    // is what stays gated. These routes still call tierAllowsFinders(). Named
    // concretely so scripts/test-feature-access.mjs can verify them.
    enforcedBy: '/api/ltk/generate + /api/social-launch-kit/generate',
  },
  labs: {
    label: 'Labs (Instagram Auto-DM)',
    tiers: PRO,
    enforcedBy: 'POST /api/instagram/dm-campaign',
    extraLocks: 'Dormant until Meta approves manage_comments / manage_messages',
  },
  dealRadar: {
    label: 'Amazon Deal Radar',
    tiers: PAID,
    enforcedBy: 'GET /api/deal-radar (+ social-post / roundup / deals) via canUseDealRadar()',
    // Graduated out of Labs 2026-07-27 → all paid tiers. Making a blog post from
    // a deal still draws from the tier's normal monthly blog-post allowance
    // (postsPerMonth via checkGenerationLimit). To dial back later, change
    // `tiers` here (e.g. to PRO or STUDIO_UP) — every gate reads this list.
    extraLocks: 'Deal → blog post counts against postsPerMonth like any post',
  },
  passport: {
    label: 'Passport Links',
    tiers: STUDIO_UP,
    // Every Passport route (settings, link-mint, analytics) + the shared
    // passportLinkForUser() gate call canUsePassport(). This matters because the
    // free SCOUT extension can hit POST /api/passport/link — without the server
    // gate, a free user could mint links. Studio + Pro only.
    enforcedBy: 'GET/POST /api/passport, POST /api/passport/link, GET /api/passport/analytics, passportLinkForUser()',
  },
} as const satisfies Record<string, NavAccessRule>

/** Can this tier ACT on Deal Radar — quick-post, roundup, make a deal blog post,
 *  weekly digest? Paid only. Single source of truth; the action routes call this. */
export function canUseDealRadar(tier: Tier | null | undefined): boolean {
  return canSeeNav('dealRadar', tier)
}

/** Can this tier use Passport Links (geo-routing links, the paste box, the
 *  dashboard, and auto-wiring into content)? Studio + Pro only. The free SCOUT
 *  extension can call the link-mint route, so this must be enforced server-side. */
export function canUsePassport(tier: Tier | null | undefined): boolean {
  return canSeeNav('passport', tier)
}

/** Can this tier BROWSE the Deal Radar feed? Every signed-in plan, including the
 *  free 'trial' plan — read-only discovery is the free-tier magnet and costs
 *  ~nothing to serve (a shared, cron-refreshed cache). Acting on a deal still
 *  requires canUseDealRadar() (paid). Gates GET /api/deal-radar + the page. */
export function canBrowseDealRadar(tier: Tier | null | undefined): boolean {
  return !!tier
}

export type FeatureKey = keyof typeof NAV_ACCESS

/** Does this tier see the sidebar entry for `feature`? */
export function canSeeNav(feature: FeatureKey, tier: Tier | null | undefined): boolean {
  if (!tier) return false
  return (NAV_ACCESS[feature].tiers as readonly Tier[]).includes(tier)
}
