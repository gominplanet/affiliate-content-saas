// Admin-only "View as tier" override.
//
// Lets an admin preview the UI exactly as a Trial / Creator / Pro user
// sees it — locked pages greyed out, gated features hidden, etc. —
// without changing their real tier in the DB.
//
// SECURITY: this is a CLIENT-SIDE PREVIEW only. effectiveTier() honours
// the override solely when the real tier is 'admin', so a non-admin
// tampering with localStorage gains nothing. Server routes always read
// the real DB tier, so impersonation never grants real access — actions
// you trigger while "viewing as" still run with your true admin rights.

import type { Tier } from '@/lib/tier'

const KEY = 'mvp_view_as_tier'
const EVENT = 'mvp:view-as-changed'

export function getViewAsTier(): Tier | null {
  if (typeof window === 'undefined') return null
  const v = window.localStorage.getItem(KEY)
  return v === 'trial' || v === 'creator' || v === 'pro' || v === 'admin' ? v : null
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
  const real = (realTier as Tier) || 'trial'
  if (real !== 'admin') return real
  return getViewAsTier() ?? 'admin'
}

export const VIEW_AS_EVENT = EVENT
