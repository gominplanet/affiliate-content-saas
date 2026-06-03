// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Edge-runtime-safe route gating for Virtual Assistants.
//
// This file exists ONLY because middleware.ts runs in Next's edge runtime,
// which can't import `node:crypto`. The main `lib/agency.ts` uses
// `randomBytes` from `node:crypto` for invite-token generation, so the
// entire module is unsafe to import from middleware. We split the few
// constants the middleware actually needs into this no-dependencies file.
//
// Anything that needs both edge-safe constants AND node-runtime helpers
// should import from `lib/agency.ts` (which re-exports BLOCKED_FOR_VAS
// and isPathBlockedForVa from here, so callers have a single import).

/** Routes a Virtual Assistant can NEVER access regardless of permissions.
 *  These are the owner-only surfaces: billing, brand identity, integrations,
 *  multi-site WordPress config, plugin connect tokens, and the team-
 *  management page itself (so VAs can't invite other VAs). Middleware +
 *  page-level checks both reference this list. */
export const BLOCKED_FOR_VAS: ReadonlyArray<string> = [
  '/branding',           // White-label config — owner's brand
  '/setup',              // Integrations (Geniuslink, Amazon, social OAuth) — owner's accounts
  '/customize',          // Blog customization
  '/billing',            // Stripe + tier management
  '/agency',             // VA management itself — VAs can't manage other VAs
  '/developers',         // API keys — owner-only
  '/admin',              // Internal MVP admin
]

/** True when the given pathname matches one of the BLOCKED_FOR_VAS roots.
 *  Used by middleware to short-circuit before the page renders. */
export function isPathBlockedForVa(pathname: string): boolean {
  return BLOCKED_FOR_VAS.some(blocked => pathname === blocked || pathname.startsWith(blocked + '/'))
}
