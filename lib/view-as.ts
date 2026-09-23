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

import { normalizeTier, SELLABLE_TIERS, type Tier } from '@/lib/tier'

const KEY = 'mvp_view_as_tier'
const EVENT = 'mvp:view-as-changed'

/** The tiers this preview offers: the plans we sell, plus the free trial.
 *
 *  IT USED TO BE A HAND-WRITTEN LIST of every value the union allowed, with a
 *  comment saying to keep it in sync, which it twice was not: a selection of
 *  Studio round-tripped to null and snapped the dropdown back to "My view
 *  (Admin)", and Amazon did the same on 2026-08-13. Derived now, so adding a
 *  plan cannot repeat it.
 *
 *  Creator and Studio are deliberately NOT here. They are frozen, nothing
 *  sells them, and previewing a plan nobody can buy answers a question nobody
 *  is asking. A stored value naming one is treated as absent below. */
export const VIEW_AS_TIERS: readonly Tier[] = ['trial', ...SELLABLE_TIERS, 'admin'] as const

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
