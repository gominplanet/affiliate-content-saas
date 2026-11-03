// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH LOOK AN ACCOUNT SEES (the Teal Pop redesign, Seb, 2026-11-03: "I like
// A. I like A the best so far, for sure").
//
// Behind Labs while it is tried on the live site (lib/labs-preview new_look).
// An account allowed to try it gets it straight away, and a switch in the menu
// takes it back to the old look. The choice is a cookie, so the server draws
// the right look on the first paint instead of flashing the old one.

import { canUsePreview } from '@/lib/labs-preview'

export type Look = 'teal' | 'classic'

/** The cookie holding the choice: 'classic' to go back, anything else is the new look. */
export const LOOK_COOKIE = 'mvp_look'

/** Can this account try the new look at all. */
export function canTryLook(tier: unknown): boolean {
  return canUsePreview('new_look', tier)
}

/** The look this account sees: the new one when it may try it and has not switched back. */
export function lookFor(tier: unknown, cookie: string | null | undefined): Look {
  if (!canTryLook(tier)) return 'classic'
  return cookie === 'classic' ? 'classic' : 'teal'
}

/** The cookie that switches to `look`, a year long, for every page. */
export function lookCookie(look: Look): string {
  return `${LOOK_COOKIE}=${look}; path=/; max-age=31536000; samesite=lax`
}
