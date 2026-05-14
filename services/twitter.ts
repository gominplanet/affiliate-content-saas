/**
 * Twitter / X service module.
 *
 * Uses OAuth 2.0 with PKCE (required by X for confidential clients).
 *
 * Scopes we request:
 *   - tweet.read       — read user info
 *   - tweet.write      — post tweets on the user's behalf
 *   - users.read       — fetch the connected user's @handle / display name
 *   - offline.access   — receive a refresh_token for long-lived sessions
 */

const TWITTER_API = 'https://api.twitter.com'

export const TWITTER_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access']

/** Build the auth header for Twitter's token endpoint (Basic client_id:client_secret). */
function basicAuth(): string {
  const id = process.env.TWITTER_CLIENT_ID!
  const secret = process.env.TWITTER_CLIENT_SECRET!
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

export type TwitterTokenResponse = {
  token_type: 'bearer'
  expires_in: number
  access_token: string
  scope: string
  refresh_token?: string
}

/** Exchange an authorization code + PKCE verifier for an access token. */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TwitterTokenResponse> {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.TWITTER_CLIENT_ID!,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const res = await fetch(`${TWITTER_API}/2/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter token exchange failed (${res.status}): ${text.slice(0, 300)}`)
  }

  return res.json() as Promise<TwitterTokenResponse>
}

/** Refresh an expired access token. */
export async function refreshAccessToken(refreshToken: string): Promise<TwitterTokenResponse> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: process.env.TWITTER_CLIENT_ID!,
  })

  const res = await fetch(`${TWITTER_API}/2/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter token refresh failed (${res.status}): ${text.slice(0, 300)}`)
  }

  return res.json() as Promise<TwitterTokenResponse>
}

export type TwitterUserProfile = {
  id: string
  name: string
  username: string
}

/** Fetch the authenticated user's basic profile (@handle, display name, ID). */
export async function getProfile(accessToken: string): Promise<TwitterUserProfile> {
  const res = await fetch(`${TWITTER_API}/2/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter /users/me failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { data: TwitterUserProfile }
  return json.data
}

/** Create a single tweet on the authenticated user's behalf. */
export async function createTweet(accessToken: string, text: string): Promise<{ id: string; text: string }> {
  const res = await fetch(`${TWITTER_API}/2/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Twitter tweet failed (${res.status}): ${errText.slice(0, 300)}`)
  }
  const json = await res.json() as { data: { id: string; text: string } }
  return json.data
}

// ─── PKCE helpers ──────────────────────────────────────────────────────────

/** Generate a cryptographically random URL-safe code_verifier (length 43-128). */
export function generateCodeVerifier(length = 64): string {
  // Use Web Crypto when available (edge runtime), fall back to Node crypto.
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto')
    nodeCrypto.randomFillSync(bytes)
  }
  return base64UrlFromBytes(bytes).slice(0, length)
}

/** Hash a code_verifier into a base64url-encoded SHA-256 code_challenge. */
export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  // Browser/edge: SubtleCrypto
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(verifier)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return base64UrlFromBytes(new Uint8Array(hash))
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto')
  const hash = nodeCrypto.createHash('sha256').update(verifier).digest()
  return base64UrlFromBytes(new Uint8Array(hash))
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  // btoa on a binary string in browser; Buffer in Node.
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
