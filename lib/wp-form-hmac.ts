// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared verification for public forms the MVP WordPress plugin renders on a
// creator's blog (newsletter signup, "Work with brands" inquiry). Those forms
// POST to mvpaffiliate.io with the creator's user id baked in — so without a
// signature, anyone could POST arbitrary creatorUserIds and flood a creator.
//
// The plugin (v1.0.27+) signs `creatorUserId|origin|ts` with
// hash_hmac('sha256', affiliateos_proxy_secret). We look up the matching WP
// site by (user_id = creatorUserId AND wordpress_url host = origin), pull its
// api_token (which mirrors the plugin's proxy_secret), decrypt, and recompute.
//
// Returns:
//   { valid: true }            — signature verified ✓
//   { valid: false, reason }   — signature present but invalid → REJECT
//   { valid: null,  reason }   — signature absent/unverifiable (old plugin or
//                                pre-multi-site install) → accept-but-warn

import { createHmac, timingSafeEqual } from 'crypto'
import { maybeDecrypt } from '@/lib/secrets'

const HMAC_MAX_AGE_SECONDS = 24 * 60 * 60

export async function verifyWpFormHmac(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  creatorUserId: string,
  payload: { origin?: string; ts?: string; sig?: string },
): Promise<{ valid: true } | { valid: false; reason: string } | { valid: null; reason: string }> {
  const { origin, ts, sig } = payload
  if (!sig || !ts || !origin) {
    return { valid: null, reason: 'sig/ts/origin missing (old plugin version)' }
  }
  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return { valid: false, reason: 'invalid ts' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsNum) > HMAC_MAX_AGE_SECONDS) {
    return { valid: false, reason: 'ts outside window' }
  }
  const originLower = origin.toLowerCase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sites } = await admin
    .from('wordpress_sites')
    .select('wordpress_url, api_token')
    .eq('user_id', creatorUserId)
  if (!sites || sites.length === 0) {
    return { valid: null, reason: 'no wordpress_sites row for creator (legacy single-site install)' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = sites.find((s: any) => {
    if (!s.wordpress_url || !s.api_token) return false
    try {
      return new URL(s.wordpress_url).hostname.toLowerCase() === originLower
    } catch { return false }
  })
  if (!match) return { valid: false, reason: 'origin does not match any registered WP site' }
  const secret = maybeDecrypt(String(match.api_token || ''))
  if (!secret) return { valid: null, reason: 'site has no api_token persisted' }

  const expected = createHmac('sha256', secret)
    .update(`${creatorUserId}|${originLower}|${ts}`)
    .digest('hex')
  if (expected.length !== sig.length) return { valid: false, reason: 'sig length mismatch' }
  const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))
  return ok ? { valid: true } : { valid: false, reason: 'hmac mismatch' }
}
