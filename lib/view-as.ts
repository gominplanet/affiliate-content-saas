// Admin-only "View as tier" override.
//
// Lets an admin preview the UI exactly as a Free Trial / Amazon / Pro user
// sees it — locked pages greyed out, gated features hidden, etc. —
// without changing their real tier in the DB.
//
// SECURITY: this is a CLIENT-SIDE PREVIEW only. effectiveTier() honours
// the override solely when the real tier is 'admin', so a non-admin
// tampering with localStorage gains nothing. Server routes always read
// the real DB tier, so impersonation never grants real access — actions
// you trigger while "viewing as" still run with your true admin rights.

import { normalizeTier, SELLABLE_TIERS, TIERS, type Tier } from '@/lib/tier'
import { seesProLocked } from '@/lib/pro-locked-nav'

const KEY = 'mvp_view_as_tier'
const EVENT = 'mvp:view-as-changed'

/** The tiers this preview offers: the plans we sell, the free trial, and the
 *  legacy plans members still hold.
 *
 *  IT USED TO BE A HAND-WRITTEN LIST of every value the union allowed, with a
 *  comment saying to keep it in sync, which it twice was not: a selection of
 *  Studio round-tripped to null and snapped the dropdown back to "My view
 *  (Admin)", and Amazon did the same on 2026-08-13. Derived now, so adding a
 *  plan cannot repeat it.
 *
 *  IT HAPPENED A THIRD TIME (Seb, 2026-11-08: "my view as dropdown is not
 *  working .. always kicking me back to admin"). When Pro became the one plan
 *  sold, this list shrank to Free, Pro and Admin, while the sidebar's own
 *  hand-typed dropdown still offered Studio, Amazon and Creator: each was
 *  saved, read back as not offered, cleared, and the page came back as Admin.
 *  Both dropdowns are built from this list now.
 *
 *  Creator and Studio are back in it: nothing sells them, but members still
 *  hold them, and they now see every Pro tool locked (lib/pro-locked-nav), so
 *  what they see is a real question. Derived from that same rule. Amazon is
 *  not: nobody holds it. A stored value naming a tier not listed here is
 *  treated as absent below. */
const LEGACY_HELD: readonly Tier[] = (Object.keys(TIERS) as Tier[]).filter(seesProLocked)
export const VIEW_AS_TIERS: readonly Tier[] = ['trial', ...SELLABLE_TIERS, ...LEGACY_HELD, 'admin'] as const

/** What the View as dropdowns call a tier. */
export function viewAsLabel(t: Tier): string {
  if (t === 'admin') return 'My view (Admin)'
  return seesProLocked(t) ? `${TIERS[t].label} (legacy)` : TIERS[t].label
}

export function getViewAsTier(): Tier | null {
  if (typeof window === 'undefined') return null
  const v = window.localStorage.getItem(KEY)
  // A stored tier that is no longer offered reads as absent AND is cleared.
  // Left in place, the <select> below would hold a value with no matching
  // option and the browser would render the first one instead, so the screen
  // would say "My view (Admin)" while the whole UI was still gated as Studio.
  if (v && !(VIEW_AS_TIERS as readonly string[]).includes(v)) {
    try { window.localStorage.removeItem(KEY) } catch { /* private mode */ }
    return null
  }
  return (VIEW_AS_TIERS as readonly string[]).includes(v ?? '') ? (v as Tier) : null
}

export function setViewAsTier(t: Tier | null) {
  if (typeof window === 'undefined') return
  if (t) window.localStorage.setItem(KEY, t)
  else window.localStorage.removeItem(KEY)
  window.dispatchEvent(new Event(EVENT))
}

/**
 * The tier the UI should render as. For admins, returns the active
 * "view as" override (if any); for everyone else, the real tier
 * untouched. Pass the tier you fetched from the DB.
 */
export function effectiveTier(realTier: Tier | string | null | undefined): Tier {
  // normalizeTier guarantees a valid Tier — so consumers that do TIERS[tier]
  // (billing, content, studio) can never crash on a missing row (new trial
  // user, no integrations row yet) or a legacy/invalid value.
  const real = normalizeTier(realTier)
  if (real !== 'admin') return real
  return getViewAsTier() ?? 'admin'
}

export const VIEW_AS_EVENT = EVENT
