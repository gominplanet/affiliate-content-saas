// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What X granted, as a pure function of a string.
//
// Split out of services/twitter so the SETUP PAGE can ask the question. That
// file reads process.env and builds Basic auth headers with Buffer, which is
// server-shaped code that has no business in a browser bundle; this module is
// three lines of string handling and safe on both sides.
//
// The rule it encodes, which is the whole reason any of this exists: a scope is
// fixed at authorization time. Refreshing an X token re-issues the SAME grant.
// So a connection made before MVP asked for media.write can never gain it, and
// the only repair is the creator reconnecting once.

/** The scope X requires to upload an image for a post. */
export const MEDIA_SCOPE = 'media.write'

/**
 * Whether a recorded grant can upload media.
 *
 * `unknown` is NOT `no`. It means the connection predates migration 337 and we
 * never recorded what was granted, which is true of every existing row on the
 * day this ships. Callers treat it as "try the upload and report what X says",
 * never as a reason to warn someone whose connection may be perfectly fine.
 */
export type MediaCapability = 'yes' | 'no' | 'unknown'

export function mediaCapability(scope: string | null | undefined): MediaCapability {
  const s = (scope ?? '').trim()
  if (!s) return 'unknown'
  return s.split(/\s+/).includes(MEDIA_SCOPE) ? 'yes' : 'no'
}
