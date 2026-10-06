// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE RULE FOR EVERY `?next=`. It used to be spelled out three times (the auth
// callback, LoginForm, labs-unlock) and the copies had drifted: labs-unlock
// still let `/\evil.com` through long after the callback learned to refuse it.

/**
 * `raw` if it is a same-origin internal path, otherwise null.
 *
 * Without this, `?next=//evil.com` slipped through: Next's URL parser tolerates
 * a leading `//` as a protocol-relative URL, so we'd cheerfully send the user
 * off-site post-login carrying their Supabase session cookie. Same problem
 * with `\\` and other URL schemes.
 *
 * Rules: must start with a single `/`, must NOT start with `//` or `/\`, must
 * NOT contain a scheme (http:, javascript:, data:, mailto:, etc.).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.startsWith('/\\')) return null
  // Reject URL-encoded slash/backslash variants that some redirect handlers
  // decode AFTER the origin check ( `/%2fevil.com`, `/%5cevil.com`,
  // `/%2F%2Fevil.com`). Belt-and-braces: also reject encoded control chars.
  if (/%2f|%5c|%0[0-9a-f]/i.test(raw)) return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null
  // Reject any scheme-looking content (e.g. `/javascript:alert()`).
  if (/^\/[^/]*:/.test(raw)) return null
  return raw
}
