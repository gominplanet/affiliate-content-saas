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

export type Look = 'teal' | 'classic'

/** The cookie the old switch wrote; no longer read. */
export const LOOK_COOKIE = 'mvp_look'

// THE NEW LOOK IS MVP (Seb, 2026-11-07: "make the new look the normal mvp"):
// every account on every plan sees it, and the switch back is gone. A
// 'classic' cookie left by the old switch is ignored.

/** Every account has the new look. */
export function canTryLook(): boolean {
  return true
}

/** The look every account sees: the new one. */
export function lookFor(): Look {
  return 'teal'
}

/** The cookie that switches to `look`, a year long, for every page. */
export function lookCookie(look: Look): string {
  return `${LOOK_COOKIE}=${look}; path=/; max-age=31536000; samesite=lax`
}
