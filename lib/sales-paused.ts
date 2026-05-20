// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Single source of truth for the "sales paused" state. Flipped via the
 * Vercel env var `NEXT_PUBLIC_SALES_PAUSED` (set to "1" to pause, unset
 * or any other value to resume; redeploy after changing).
 *
 * Using a NEXT_PUBLIC_ var so both server (checkout gate, signup form
 * wrapper) and client (landing CTAs, pricing page, sidebar) can read
 * the same flag without an extra fetch — the value isn't sensitive.
 *
 * When paused:
 *   - /api/stripe/checkout returns 503 (no Stripe Checkout session is
 *     created, so no one can buy via direct URL or stale link).
 *   - The signup form refuses to submit and shows a "back soon" notice.
 *   - Landing + /pricing CTAs render in a disabled "Sales paused" state.
 *   - The "Earn 10% — Refer" sidebar entry is hidden.
 *
 * NOT covered by this flag (the bulletproof complement):
 *   - Supabase Dashboard → Authentication → Providers → Email → toggle
 *     OFF "Allow new users to sign up". This blocks signups at the auth
 *     layer regardless of any client-side check — recommended whenever
 *     this flag is on.
 */

export const SALES_PAUSED =
  (process.env.NEXT_PUBLIC_SALES_PAUSED ?? '').trim() === '1'

export const SALES_PAUSED_MESSAGE =
  'Sales are temporarily paused while we prepare a launch event. Back online shortly — thanks for your patience.'
