/**
 * Stateless OAuth state for the WordPress Authorize-Application redirect flow.
 *
 * Why HMAC-signed state instead of a DB table:
 *  - Vercel serverless functions can't share in-memory state across instances.
 *  - We don't need persistence — the state is valid for 10 minutes max.
 *  - Avoids a DB migration just to hold ephemeral request handles.
 *
 * The state encodes the MVP user_id + the WP site URL they typed, plus an
 * expiry. It's HMAC-signed with the Supabase service-role key (server-only
 * secret that already lives in env) so the callback can verify it came from
 * our /oauth-start and hasn't been tampered with.
 *
 * Flow:
 *   1. /oauth-start signs `{userId, siteUrl, exp}` → state
 *   2. We embed `state` as a query param in `success_url` we send to WordPress
 *   3. WordPress redirects back with `state` + the credentials it minted
 *   4. /oauth-callback verifies the state HMAC, extracts userId+siteUrl, stores creds
 */
import { createHmac, timingSafeEqual } from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getSecret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY required to sign WP OAuth state')
  }
  return s
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export interface WpOAuthState {
  userId: string
  siteUrl: string
  exp: number // ms since epoch
}

/** Build a signed state token. */
export function signState(payload: Omit<WpOAuthState, 'exp'>): string {
  const full: WpOAuthState = { ...payload, exp: Date.now() + STATE_TTL_MS }
  const body = b64urlEncode(JSON.stringify(full))
  const sig = createHmac('sha256', getSecret()).update(body).digest()
  return `${body}.${b64urlEncode(sig)}`
}

/** Verify and decode a state token. Returns null on any failure. */
export function verifyState(state: string | null | undefined): WpOAuthState | null {
  if (!state || typeof state !== 'string') return null
  const dot = state.lastIndexOf('.')
  if (dot < 1) return null
  const body = state.slice(0, dot)
  const sigStr = state.slice(dot + 1)

  let providedSig: Buffer
  try {
    providedSig = b64urlDecode(sigStr)
  } catch {
    return null
  }
  const expectedSig = createHmac('sha256', getSecret()).update(body).digest()
  if (providedSig.length !== expectedSig.length) return null
  if (!timingSafeEqual(providedSig, expectedSig)) return null

  let parsed: WpOAuthState
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf8')) as WpOAuthState
  } catch {
    return null
  }
  if (!parsed.userId || !parsed.siteUrl || typeof parsed.exp !== 'number') return null
  if (Date.now() > parsed.exp) return null
  return parsed
}

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
