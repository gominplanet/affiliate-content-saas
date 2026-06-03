// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// API-key helpers for the Pro-tier /api/v1/* surface.
//
//   generateApiKey()      → create a new plaintext key + hash for storage
//   hashApiKey(plain)     → deterministic SHA-256 of a plaintext key
//   authenticateApiKey()  → middleware: parse Authorization header → user row
//                           or null if invalid/revoked
//
// The plaintext key is shown to the user ONCE at creation time. We persist
// only the SHA-256. Format: `mvp_live_<32 url-safe random chars>` so a leaked
// key is easy to identify in logs + revoke.

import { randomBytes, createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'

/** All API keys start with this so they're easy to grep in logs + identify
 *  as MVP-issued. The "live" segment leaves room for future "test" keys. */
const KEY_PREFIX = 'mvp_live_'
/** Length of the random tail in characters (post-prefix). 32 chars of
 *  base64url = 192 bits of entropy — way more than enough for an auth
 *  token. */
const RANDOM_LEN = 32

/** Sha-256 hex of a plaintext key. Constant-time hashing on Node's crypto. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export interface GeneratedKey {
  /** Plaintext key — show to the user ONCE, never store. */
  plaintext: string
  /** SHA-256 hex — persist this in api_keys.key_hash. */
  hash: string
  /** First ~10 chars of the plaintext. Persist in api_keys.key_prefix for
   *  the UI to show "Key starting with mvp_live_ab..." without exposing
   *  the secret. */
  prefix: string
}

/**
 * Mint a fresh API key. Caller must persist `hash` + `prefix`; the
 * `plaintext` is for the user to copy ONCE.
 *
 * Random source: Node's crypto.randomBytes (CSPRNG, suitable for tokens).
 * Encoding: base64url, no padding — URL-safe, no escapes needed.
 */
export function generateApiKey(): GeneratedKey {
  // 24 raw bytes → 32 base64url chars (no padding).
  const tail = randomBytes(24).toString('base64url').slice(0, RANDOM_LEN)
  const plaintext = `${KEY_PREFIX}${tail}`
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    // Show enough of the prefix to identify the key in the UI without
    // leaking too much — ~10 chars = "mvp_live_a" through "mvp_live_aB".
    prefix: plaintext.slice(0, KEY_PREFIX.length + 2),
  }
}

export interface AuthenticatedApiCaller {
  /** user_id of the key's owner. Pass this to downstream Supabase
   *  queries via .eq('user_id', userId). */
  userId: string
  /** The api_keys row id — useful for logging which key was used. */
  apiKeyId: string
  /** Caller's tier at the time of auth (admin-resolved). */
  tier: string
}

/**
 * Authenticate an incoming /api/v1/* request via its Authorization header.
 * Returns the caller info on success, or a structured error on failure
 * (so the route can return a precise 401/403). Bumps last_used_at as a
 * side effect on success.
 *
 * Failure shapes:
 *   { error: 'missing-bearer' }   — header absent or not "Bearer <token>"
 *   { error: 'invalid-format' }   — token doesn't start with `mvp_live_`
 *   { error: 'unknown-key' }      — hash not found in api_keys (or revoked)
 *   { error: 'tier-not-allowed' } — key exists but the user's current tier
 *                                   isn't Pro/admin (downgraded user)
 */
export type ApiAuthResult =
  | { ok: true; caller: AuthenticatedApiCaller }
  | { ok: false; error: 'missing-bearer' | 'invalid-format' | 'unknown-key' | 'tier-not-allowed' }

export async function authenticateApiKey(req: NextRequest): Promise<ApiAuthResult> {
  const header = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!header) return { ok: false, error: 'missing-bearer' }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return { ok: false, error: 'missing-bearer' }
  const token = match[1].trim()
  if (!token.startsWith(KEY_PREFIX)) return { ok: false, error: 'invalid-format' }

  const admin = createAdminClient()
  const hash = hashApiKey(token)

  // Single point lookup — index on (key_hash) WHERE revoked_at IS NULL
  // ensures revoked keys can't authenticate even if the hash matches.
  // Cast through `any` since Supabase TS types pre-date migration 087.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (admin as any)
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()
  if (!keyRow) return { ok: false, error: 'unknown-key' }

  // Confirm the user is still on a tier that's allowed to use the API.
  // If they downgraded after minting the key we want auth to fail
  // immediately (no need to revoke each key on every downgrade).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await admin
    .from('integrations')
    .select('tier')
    .eq('user_id', keyRow.user_id)
    .maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return { ok: false, error: 'tier-not-allowed' }
  }

  // Bump last_used_at — fire-and-forget (don't block the request).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (admin as any).from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)

  return {
    ok: true,
    caller: { userId: keyRow.user_id as string, apiKeyId: keyRow.id as string, tier },
  }
}

/** HTTP status + body for a failed API-key auth result. Used by the
 *  /api/v1/* route handlers to return a consistent shape. */
export function apiAuthErrorResponse(err: Exclude<ApiAuthResult, { ok: true }>['error']): { status: number; body: { error: string; code: string } } {
  switch (err) {
    case 'missing-bearer':
      return { status: 401, body: { error: 'Missing Authorization: Bearer <token> header', code: 'missing_bearer' } }
    case 'invalid-format':
      return { status: 401, body: { error: 'Token does not match expected format (mvp_live_...)', code: 'invalid_format' } }
    case 'unknown-key':
      return { status: 401, body: { error: 'API key not recognised, or revoked', code: 'unknown_key' } }
    case 'tier-not-allowed':
      return { status: 403, body: { error: 'API access requires the Pro tier', code: 'tier_not_allowed' } }
  }
}
