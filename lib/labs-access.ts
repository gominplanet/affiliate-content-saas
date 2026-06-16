// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Early-access gate for the LABS tools (EPC Scout, PartnerBoost). LABS is
// limited to a few invited users via a single SHARED password handed out
// manually — on top of the existing tier gates (EPC = Pro+, PartnerBoost =
// admin). The password lives ONLY in the server env `LABS_PASSWORD`.
//
// Flow: the user hits a LABS page → middleware redirects to /labs-unlock →
// they enter the password → /api/labs/unlock validates it and sets the
// `labs_unlocked` cookie (httpOnly, value = SHA-256 of the password, never the
// raw password) → middleware lets LABS requests through while the cookie holds.
//
// If `LABS_PASSWORD` is UNSET the gate is OPEN (returns no token) — so the
// feature keeps working exactly as before until the password is configured in
// Vercel. Set LABS_PASSWORD to activate the lock. Runtime-agnostic: uses Web
// Crypto (`crypto.subtle`), available in both the Edge middleware and Node API
// routes.

export const LABS_COOKIE = 'labs_unlocked'

/** Hex SHA-256 of an arbitrary string. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cookie token for a candidate password (what /api/labs/unlock stores on success). */
export function labsTokenFor(password: string): Promise<string> {
  return sha256Hex(password)
}

/**
 * The token a valid `labs_unlocked` cookie must equal, derived from the env
 * password. Returns null when `LABS_PASSWORD` is unset → callers treat that as
 * "gate open" (no lock configured).
 */
export async function expectedLabsToken(): Promise<string | null> {
  const pw = process.env.LABS_PASSWORD
  if (!pw) return null
  return sha256Hex(pw)
}
