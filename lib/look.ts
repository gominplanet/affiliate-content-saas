// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH LOOK AN ACCOUNT SEES (the Teal Pop redesign, Seb, 2026-11-03: "I like
// A. I like A the best so far, for sure").
//
// On its own switch (lib/labs-preview new_look): open to Pro since
// 2026-11-03 (Seb: "open it to pro"). An account allowed it gets it straight
// away, and a switch at the foot of the menu takes it back to the old look.
// The choice is a cookie, so the server draws the right look on the first
// paint instead of flashing the old one.

import { canUsePreview, previewOpenToPro } from '@/lib/labs-preview'
import { normalizeTier } from '@/lib/tier'

export type Look = 'teal' | 'classic'

/** The cookie holding the choice: 'classic' to go back, anything else is the new look. */
export const LOOK_COOKIE = 'mvp_look'

// EVERY PAYING MEMBER, not just Pro (Seb, 2026-11-04, of the legacy Studio
// and Creator accounts: "yes"), so tutorials, screenshots and support answers
// match one MVP. These two plans are no longer sold; their members keep them.
const LEGACY_PAID = new Set(['studio', 'creator'])

/** Can this account have the new look: Pro (and admin) by its switch, and the
 *  legacy paid plans once it is open to Pro. */
export function canTryLook(tier: unknown): boolean {
  if (canUsePreview('new_look', tier)) return true
  return previewOpenToPro('new_look') && LEGACY_PAID.has(normalizeTier(tier))
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
