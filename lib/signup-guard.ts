// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PAID SIGNUP IS A FRONT DOOR WITHOUT THE LOCKS THE OTHER ONE HAS.
//
// /api/auth/signup-paid creates an account ALREADY CONFIRMED with the
// service-role key, so it skips everything Supabase puts in front of a normal
// signup: the captcha (Turnstile is checked by Supabase, and this route never
// went through Supabase's signup), the confirmation email and Supabase's own
// signup rate limits. Abandoning the Stripe page leaves a working Free account
// with its AI allowance, so a script could mint those from made-up addresses
// as fast as it liked. Two locks, both here:
//
//   1. The Turnstile token the form already collects is verified server side,
//      when TURNSTILE_SECRET_KEY is set (the same secret pasted into Supabase).
//   2. A per-network ceiling, counted in signup_attempts (migration 410). A
//      database without that table is not blocked: the throttle steps aside
//      rather than stopping real buyers.

import { createHash } from 'node:crypto'

/** Paid signups one network may START per hour. A household, an office or a
 *  phone retrying a declined card stays well under it. */
export const PAID_SIGNUPS_PER_IP_HOUR = 5

export function signupIpHash(ip: string | null | undefined): string | null {
  const v = (ip || '').trim()
  if (!v) return null
  const salt = process.env.NEWSLETTER_IP_SALT || 'mvp-signup-fallback-salt'
  return createHash('sha256').update(`signup:${v}::${salt}`).digest('hex')
}

/** The caller's IP as Vercel reports it. */
export function requestIp(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null
}

/** True when the captcha must be checked: the form shows the widget (site key)
 *  AND the server can verify it (secret). Either one alone is a setup in
 *  progress, and requiring it then would refuse every buyer. */
export function captchaEnforced(): boolean {
  return !!(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

/** Verify a Turnstile token with Cloudflare. False on any failure: an
 *  unverifiable token is not a verified one. */
export async function turnstileOk(token: string | null | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !token) return false
  try {
    const form = new URLSearchParams({ secret, response: token })
    if (ip) form.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    })
    const j = await res.json().catch(() => ({})) as { success?: boolean }
    return j.success === true
  } catch {
    return false
  }
}

/** Count this network's recent attempts and record this one. Returns true when
 *  it is over the ceiling. Steps aside (false) when the table is missing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function paidSignupThrottled(admin: any, ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count, error } = await admin.from('signup_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash).gte('created_at', since)
    if (error) {
      // Said out loud: a throttle that is silently off looks exactly like one
      // that is working. Run migration 410 to switch it on.
      console.warn('[signup-guard] signup_attempts unreadable, paid signup throttle is OFF:', error.message)
      return false
    }
    if ((count ?? 0) >= PAID_SIGNUPS_PER_IP_HOUR) return true
    await admin.from('signup_attempts').insert({ ip_hash: ipHash, kind: 'paid' })
    return false
  } catch {
    return false
  }
}
