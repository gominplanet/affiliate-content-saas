/**
 * Helpers for the WordPress Authorize-Application connect flow.
 *
 * STATE LIVES IN lib/oauth-state NOW (2026-10-06 security fix). This file used
 * to mint an HMAC-signed `{userId, siteUrl, exp}` state that was valid for its
 * whole ten minutes, so the same callback link could be replayed. The flow now
 * uses the shared one-time state cookie like every other connect.
 */

/**
 * Normalize a user-typed WP site URL: enforce https, strip trailing slash,
 * strip /wp-admin/* if they pasted the admin URL. Returns null if invalid.
 */
export function normalizeWpSiteUrl(input: string | null | undefined): string | null {
  if (!input) return null
  let s = String(input).trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // Force https in production — WP's authorize-application.php redirect
    // exposes the Application Password in the URL, so plaintext http is a
    // hard no.
    u.protocol = 'https:'
    u.pathname = u.pathname.replace(/\/wp-admin\/?.*$/, '').replace(/\/+$/, '')
    if (!u.hostname.includes('.')) return null
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

/**
 * App ID for the Authorize-Application flow. WordPress uses this as a stable
 * identifier so re-authorizing replaces the same Application Password instead
 * of stacking duplicates in the user's AP list.
 *
 * RFC 4122 v4 UUID, randomly generated once for MVP Affiliate.
 */
export const MVP_WP_APP_ID = 'b3e6f9d4-2c1a-4f87-9a5d-7e1b2c3d4e5f'
export const MVP_WP_APP_NAME = 'MVP Affiliate'
