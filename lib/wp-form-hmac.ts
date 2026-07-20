// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared verification for public forms the MVP WordPress plugin renders on a
// creator's blog (newsletter signup, "Work with brands" inquiry). Those forms
// POST to mvpaffiliate.io with the creator's user id baked in — so without a
// signature, anyone could POST arbitrary creatorUserIds and flood a creator.
//
// The plugin (v1.0.27+) signs `creatorUserId|origin|ts` with
// hash_hmac('sha256', affiliateos_proxy_secret). We look up the matching WP
// site by (user_id = creatorUserId AND url host = origin), pull its api_token
// (which mirrors the plugin's proxy_secret), decrypt, and recompute.
//
// 2026-07-20: this guard had never once fired. It selected `wordpress_url`,
// but the column on wordpress_sites is `url` — PostgREST errored the whole
// select, the error was discarded, and `sites` came back null, which the code
// read as "legacy install" and accepted. Any correctly-signed request failed
// to verify, and any forged one sailed through.
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

  // Load the creator's sites FIRST. Deciding "is a signature required?" has to
  // come from what we know about the creator's install, not from whether the
  // caller bothered to send one — otherwise omitting sig/ts/origin entirely is
  // a free bypass, which is exactly what an attacker would do.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sites, error: sitesErr } = await admin
    .from('wordpress_sites')
    .select('url, api_token')
    .eq('user_id', creatorUserId)

  if (sitesErr) {
    // Never silently fail open on an infra error the way the old
    // wrong-column query did — signups shouldn't die during a DB blip, but
    // this must be loud enough to notice.
    console.error('[wp-form-hmac] site lookup failed — falling back to accept-but-warn', sitesErr.message)
    return { valid: null, reason: `site lookup failed: ${sitesErr.message}` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signable = (sites || []).filter((s: any) => s.url && s.api_token)
  if (signable.length === 0) {
    return { valid: null, reason: 'creator has no site with an api_token (legacy install)' }
  }

  // This creator CAN sign, so an unsigned request is not a legacy client —
  // it's forged. Reject rather than accept-but-warn.
  if (!sig || !ts || !origin) {
    return { valid: false, reason: 'signature required (creator has a signing-capable site)' }
  }

  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return { valid: false, reason: 'invalid ts' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - tsNum) > HMAC_MAX_AGE_SECONDS) {
    return { valid: false, reason: 'ts outside window' }
  }
  const originLower = origin.toLowerCase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = signable.find((s: any) => {
    try {
      return new URL(s.url).hostname.toLowerCase() === originLower
    } catch { return false }
  })
  if (!match) return { valid: false, reason: 'origin does not match any registered WP site' }
  const secret = maybeDecrypt(String(match.api_token || ''))
  if (!secret) return { valid: false, reason: 'site api_token could not be decrypted' }

  const expected = createHmac('sha256', secret)
    .update(`${creatorUserId}|${originLower}|${ts}`)
    .digest('hex')
  if (expected.length !== sig.length) return { valid: false, reason: 'sig length mismatch' }
  const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))
  return ok ? { valid: true } : { valid: false, reason: 'hmac mismatch' }
}
