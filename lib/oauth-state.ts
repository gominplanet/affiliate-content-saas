/**
 * One-time OAuth `state` for every "Connect <platform>" flow.
 *
 * WHY THIS EXISTS (2026-10-06 security fix). Every connect flow used the
 * member's user id (or base64 of it) as `state`. The callbacks did check it
 * against the session, but a user id is guessable and was reusable forever, so
 * a crafted callback link could still replay or pre-build a valid state. Now:
 *
 *   start    → newOAuthState(): 32 random bytes as `state`, and an httpOnly,
 *              Secure, SameSite=Lax cookie scoped to the callback path holding
 *              { state, uid, data, exp }, HMAC-signed so it cannot be forged.
 *   callback → consumeOAuthState(): DELETE the cookie first (single use), then
 *              require the `state` param to equal the cookie's state (constant
 *              time) and hand back uid + data. The route still compares uid
 *              with the session user, exactly as before.
 *
 * Anything a flow used to pack INTO state (return path, "add another channel",
 * the X PKCE verifier) now rides in `data`, inside the httpOnly cookie, never
 * in the URL.
 *
 * HOST TRAP. The app answers on mvpaffiliate.io AND www.mvpaffiliate.io and
 * cookies are host-only, so a cookie set on one host never reaches a callback
 * on the other. callbackHostRedirect() sends a start request to the callback's
 * own host first, so the cookie is set where the provider will return.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export type OAuthProvider =
  | 'youtube' | 'gsc' | 'facebook' | 'instagram' | 'linkedin'
  | 'pinterest' | 'twitter' | 'threads' | 'tiktok' | 'wordpress'

export type OAuthStateData = Record<string, string | boolean | undefined>

export const OAUTH_STATE_TTL_SECONDS = 10 * 60

// ONE SENTENCE FOR EVERY REFUSAL. Missing cookie, expired cookie, tampered
// cookie and a state from another browser all look the same to the member:
// nothing was connected and pressing Connect again fixes it.
export const OAUTH_STATE_EXPIRED_MESSAGE =
  'That connection link expired or was not started here. Please press Connect again.'

export const oauthStateCookieName = (provider: OAuthProvider) => `mvp_oauth_state_${provider}`

interface Payload { s: string; uid: string; d: OAuthStateData; exp: number }

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('OAUTH_STATE_SECRET or SUPABASE_SERVICE_ROLE_KEY is required to sign OAuth state')
  return s
}

const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url')

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Pure: mint a random state and the signed cookie value that vouches for it. */
export function newOAuthState(uid: string, data: OAuthStateData = {}, now = Date.now()): { state: string; cookieValue: string } {
  const state = randomBytes(32).toString('base64url')
  const body = Buffer.from(JSON.stringify({ s: state, uid, d: data, exp: now + OAUTH_STATE_TTL_SECONDS * 1000 } satisfies Payload)).toString('base64url')
  return { state, cookieValue: `${body}.${sign(body)}` }
}

/** Pure: the cookie's uid + data when `stateParam` is the state it vouches for, else null. */
export function checkOAuthState(
  cookieValue: string | null | undefined,
  stateParam: string | null | undefined,
  now = Date.now(),
): { uid: string; data: OAuthStateData } | null {
  if (!cookieValue || !stateParam) return null
  const dot = cookieValue.lastIndexOf('.')
  if (dot < 1) return null
  const body = cookieValue.slice(0, dot)
  if (!safeEqual(cookieValue.slice(dot + 1), sign(body))) return null
  let p: Payload
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload } catch { return null }
  if (!p || typeof p.s !== 'string' || typeof p.uid !== 'string' || !p.uid || typeof p.exp !== 'number') return null
  if (p.exp < now) return null
  if (!safeEqual(stateParam, p.s)) return null
  return { uid: p.uid, data: p.d && typeof p.d === 'object' ? p.d : {} }
}

const cookieOpts = (callbackUrl: string) => ({
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  // Scoped to the callback so the cookie rides on that one request only.
  path: new URL(callbackUrl).pathname,
})

/** The two cookie calls this file needs; next/headers' cookies() satisfies it. */
export interface OAuthCookieJar {
  get(name: string): { value: string } | undefined
  set(name: string, value: string, opts: ReturnType<typeof cookieOpts> & { maxAge: number }): unknown
}

/**
 * Start route: set the one-time cookie and return the `state` to put in the
 * authorize URL. `callbackUrl` is the exact redirect_uri the provider returns to.
 * `jar` is for the guard script only; routes use the request's cookies.
 */
export async function startOAuthState(
  provider: OAuthProvider, uid: string, callbackUrl: string, data: OAuthStateData = {},
  jar?: OAuthCookieJar,
): Promise<string> {
  const { state, cookieValue } = newOAuthState(uid, data)
  const j: OAuthCookieJar = jar ?? await cookies()
  j.set(oauthStateCookieName(provider), cookieValue, { ...cookieOpts(callbackUrl), maxAge: OAUTH_STATE_TTL_SECONDS })
  return state
}

/**
 * Callback route: delete the cookie (single use, whatever the outcome), then
 * verify. Returns the uid + data the start route stored, or null on any
 * mismatch, expiry or missing cookie. The caller must still compare uid with
 * the session user.
 */
export async function consumeOAuthState(
  provider: OAuthProvider, stateParam: string | null, callbackUrl: string,
  jar?: OAuthCookieJar,
): Promise<{ uid: string; data: OAuthStateData } | null> {
  const j: OAuthCookieJar = jar ?? await cookies()
  const name = oauthStateCookieName(provider)
  const value = j.get(name)?.value
  // BURN IT BEFORE LOOKING AT IT. A refused or replayed callback must not
  // leave a usable cookie behind for a second try.
  j.set(name, '', { ...cookieOpts(callbackUrl), maxAge: 0 })
  return checkOAuthState(value, stateParam)
}

/**
 * Start route: when this request arrived on a different host than the
 * callback (apex vs www), the URL of this same start route on the callback's
 * host, so the state cookie lands where the provider returns. Null when the
 * hosts already match. The `oauth_host=1` marker stops a redirect loop if a
 * proxy ever reports the host differently.
 */
export function callbackHostRedirect(request: Request, callbackUrl: string): string | null {
  const reqUrl = new URL(request.url)
  if (reqUrl.searchParams.get('oauth_host') === '1') return null
  const reqHost = (request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host).split(',')[0].trim().toLowerCase()
  const cb = new URL(callbackUrl)
  if (!reqHost || reqHost === cb.host.toLowerCase()) return null
  const to = new URL(reqUrl.pathname + reqUrl.search, cb.origin)
  to.searchParams.set('oauth_host', '1')
  return to.toString()
}
