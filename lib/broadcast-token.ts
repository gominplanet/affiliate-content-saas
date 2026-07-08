// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Self-contained, unforgeable unsubscribe tokens for operator broadcasts.
//
// A broadcast email is sent to a user's inbox, so its unsubscribe link has to
// work with no session. We encode the user id + an HMAC signature into the
// token: the /api/email/unsubscribe route verifies the signature (proving MVP
// minted it) and flips integrations.marketing_opt_out for that id. No DB
// lookup needed to validate, and nobody can forge a link to unsubscribe
// someone else.

import { createHmac, timingSafeEqual } from 'crypto'

// Any stable server-only secret works — we never expose this. Prefer a
// dedicated var; fall back to the service-role key so the feature works
// without extra env setup (both are server-only and long-lived).
function secret(): string {
  return (
    process.env.BROADCAST_UNSUB_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'mvp-broadcast-dev-secret'
  )
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sig(userId: string): string {
  return b64url(createHmac('sha256', secret()).update(userId).digest())
}

/** Mint an unsubscribe token for a user id → "<b64url(id)>.<b64url(hmac)>". */
export function signUnsub(userId: string): string {
  return `${b64url(Buffer.from(userId))}.${sig(userId)}`
}

/** Verify a token and return the user id, or null if tampered/malformed. */
export function verifyUnsub(token: string): string | null {
  const parts = (token || '').split('.')
  if (parts.length !== 2) return null
  let userId: string
  try {
    userId = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return null
  }
  if (!userId) return null
  const expected = sig(userId)
  const a = Buffer.from(parts[1])
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  return timingSafeEqual(a, b) ? userId : null
}
