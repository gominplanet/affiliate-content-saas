/**
 * Server-only encryption helpers for credentials stored in Postgres.
 *
 * Background: tonight's 2026-06-02 audit flagged that WordPress App
 * Passwords, social OAuth tokens, and the body-auth proxy secrets were
 * stored as plaintext in `integrations`, `wordpress_sites`, and
 * `social_accounts`. If RLS is ever bypassed (route swap, future
 * migration, or a service-role key leak) every connected site's admin
 * credential would be exposed in a single SELECT. This module closes
 * that gap by encrypting secrets at the application layer with
 * AES-256-GCM (authenticated encryption — ciphertext + auth tag
 * protects against tampering as well as eavesdropping).
 *
 * Stored format:
 *   "enc:v1:<base64url(iv || ciphertext || tag)>"
 *
 * The "enc:v1:" magic prefix lets readers detect "is this already
 * encrypted?" — critical for the transitional period where some rows
 * are encrypted and some are still legacy plaintext. Once a migration
 * sweep is complete, the plaintext-fallback in decryptSecret() can be
 * removed (defense in depth).
 *
 * Versioning: `v1` is baked into the prefix so we can rotate the cipher
 * (e.g., to v2 with a different mode or longer keys) without breaking
 * existing data — readers dispatch on version.
 *
 * Key management: `MVP_CRYPTO_KEY` env var, 32 random bytes hex-encoded
 * (64 chars). Generate with:
 *   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
 * Set as a Vercel sensitive env var (so it's write-only after creation).
 *
 * Key rotation: future work — add a new key, mark old as decrypt-only,
 * re-encrypt all rows, swap. Out of scope for v1.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const PREFIX_V1 = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12  // GCM standard: 96-bit IV
const TAG_BYTES = 16 // GCM standard: 128-bit auth tag

/** Lazy-parsed encryption key. Throws on first use if MVP_CRYPTO_KEY is
 *  missing or malformed — fail loud, not silently corrupt data. */
let _keyCache: Buffer | null = null
function getKey(): Buffer {
  if (_keyCache) return _keyCache
  const raw = process.env.MVP_CRYPTO_KEY
  if (!raw) {
    throw new Error('MVP_CRYPTO_KEY env var is required for secrets encryption. Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"')
  }
  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== 32) {
    throw new Error(`MVP_CRYPTO_KEY must be 32 bytes hex (64 hex chars). Got ${buf.length} bytes from ${raw.length} chars.`)
  }
  _keyCache = buf
  return buf
}

/** Returns true when the input is in our encrypted format. Cheap O(1)
 *  string-prefix check — safe to call on every read. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX_V1)
}

/** Encrypt a plaintext secret. Throws if the env key is unavailable —
 *  encryption MUST succeed at write time or we'd silently store
 *  plaintext + claim it was encrypted. */
export function encryptSecret(plaintext: string): string {
  if (plaintext == null) {
    throw new Error('encryptSecret called with null/undefined')
  }
  // Already-encrypted? Pass through (idempotent — safe for double-wraps
  // in edge cases like row-copy paths).
  if (isEncrypted(plaintext)) return plaintext
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const combined = Buffer.concat([iv, ct, tag])
  return PREFIX_V1 + combined.toString('base64url')
}

/** Decrypt an encrypted secret. If the input doesn't have our magic
 *  prefix, it's treated as legacy plaintext and returned as-is — this
 *  is the transitional behaviour for rows that haven't been migrated
 *  yet. After a full migration sweep, callers can wrap this in a
 *  strict-mode flag and reject plaintext to enforce encryption at rest.
 *
 *  Throws on malformed ciphertext (truncated, wrong tag, key mismatch)
 *  rather than silently returning garbage — the caller gets a clear
 *  error like "decrypt failed — bad key or tampered data". */
export function decryptSecret(stored: string | null | undefined): string {
  if (stored == null || stored === '') return ''
  if (!isEncrypted(stored)) return stored // legacy plaintext fallback
  const b64 = stored.slice(PREFIX_V1.length)
  const combined = Buffer.from(b64, 'base64url')
  if (combined.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('decryptSecret: ciphertext too short')
  }
  const iv = combined.subarray(0, IV_BYTES)
  const tag = combined.subarray(combined.length - TAG_BYTES)
  const ct = combined.subarray(IV_BYTES, combined.length - TAG_BYTES)
  const key = getKey()
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (err) {
    throw new Error(`decryptSecret: ${err instanceof Error ? err.message : 'auth failed'}`)
  }
}

/** Null-safe encrypt — returns the same null/empty for callers that
 *  pass nullable column values straight through.
 *
 *  Use this everywhere a secret column gets WRITTEN, e.g.:
 *      .from('integrations').upsert({
 *        wordpress_app_password: maybeEncrypt(password),
 *        facebook_page_access_token: maybeEncrypt(fbToken),
 *      })
 */
export function maybeEncrypt(v: string | null | undefined): string | null | undefined {
  if (v == null || v === '') return v
  return encryptSecret(v)
}

/** Null-safe decrypt — mirrors maybeEncrypt for reads.
 *
 *  Use this on every READ of a secret column, e.g.:
 *      const password = maybeDecrypt(row.wordpress_app_password)
 *      const fbToken = maybeDecrypt(row.facebook_page_access_token)
 */
export function maybeDecrypt(v: string | null | undefined): string | null | undefined {
  if (v == null || v === '') return v
  return decryptSecret(v)
}
