// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Shared helpers for the newsletter feature — used by the public-facing
// subscribe / confirm / unsubscribe routes AND the dashboard pages, so the
// behaviour around tokens, email validation, sender-address derivation and
// the confirmation-email HTML stays consistent across both surfaces.
//
// What lives here:
//   * EMAIL_RE                — server-side email-format validator
//   * newToken()              — URL-safe random token for confirm + unsub links
//   * hashIp()                — Sha-256 of (ip + salt) for floods/dedup
//   * deriveFromAddress()     — builds the "Name <newsletter@mail.<domain>>"
//                               header from a creator's newsletter_settings row
//   * confirmationEmailHtml() — the responsive HTML body for the double-opt-in
//                               confirmation email (intentionally minimal —
//                               not the broadcast template, which is built
//                               separately in milestone 3)

import { createHash, randomBytes } from 'crypto'

/** Permissive RFC 5322-ish check — same shape the WP form uses client-side.
 *  Catches the obvious garbage ("foo", "x@", "@y.com", spaces) without trying
 *  to fully validate (which is famously impossible in a regex). The real
 *  deliverability check is the double-opt-in click that follows. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Strict normaliser — lower-case, trim, strip surrounding angle brackets.
 *  ALWAYS apply before reading or writing to newsletter_subscribers so the
 *  unique index on (user_id, lower(email)) actually does its job. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/^<|>$/g, '')
}

/** URL-safe random token, ~22 chars of base64url. Plenty of entropy
 *  (128 bits) for confirm + unsub links — collision-safe, can't be guessed. */
export function newToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Sha-256 of (ip + project salt) so we can flood-detect a single signup IP
 *  without storing raw IPs. The salt MUST be set in env or we silently fall
 *  back to a constant — which would still gate floods but would let two
 *  deploys with different envs disagree on the same IP. Acceptable for v1.
 *
 *  Returns a 64-char hex string; callers store it in signup_ip_hash. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const salt = process.env.NEWSLETTER_IP_SALT || 'mvp-newsletter-fallback-salt'
  return createHash('sha256').update(`${ip}::${salt}`).digest('hex')
}

/** Build the From header from a newsletter_settings row. Falls back to
 *  the shared MVP-controlled sender if the creator hasn't verified their
 *  own domain yet (milestone 2). When that happens the From line still
 *  reads "Their Brand <newsletter@mvpaffiliate.io>" so subscribers see
 *  the brand name — better than a bare MVP address.
 *
 *  Returns null when neither a verified creator domain NOR a shared sender
 *  is available — callers MUST refuse to send in that case. */
export function deriveFromAddress(opts: {
  /** From newsletter_settings — null when row doesn't exist yet. */
  senderDomain: string | null | undefined
  /** Defaults to 'newsletter' when unset on the row. */
  senderLocalPart: string | null | undefined
  /** Display name, e.g. "Gomin Reviews". Optional but strongly recommended. */
  senderName: string | null | undefined
  /** 'verified' | 'pending' | 'failed' from Resend. Only 'verified' lets the
   *  creator's own domain be used; anything else falls back to MVP's shared. */
  domainStatus: string | null | undefined
}): string | null {
  const fallbackDomain = 'mvpaffiliate.io'
  const local = (opts.senderLocalPart || 'newsletter').trim()
  // Use the creator's own subdomain only once it's properly verified;
  // otherwise fall back to a sender on the shared MVP domain so we can
  // still ship confirmation emails before milestone 2 is done.
  const domain = (opts.domainStatus === 'verified' && opts.senderDomain)
    ? opts.senderDomain.trim()
    : fallbackDomain
  const address = `${local}@${domain}`
  // Wrap with a display name if we have one. Strip quotes/angle brackets so
  // a sloppy sender_name can't break the header.
  const name = (opts.senderName || '').trim().replace(/["<>]/g, '')
  return name ? `${name} <${address}>` : address
}

/** Responsive HTML for the double-opt-in confirmation email. Minimal by
 *  design — its only job is to surface the "Confirm" button and avoid
 *  looking like phishing. The broadcast template (milestone 3) is what
 *  carries the brand styling.
 *
 *  Inputs are validated by the caller; this function does NOT escape its
 *  text inputs (assumes they're already safe). brandName + confirmUrl
 *  go into the body verbatim. */
export function confirmationEmailHtml(opts: {
  brandName: string
  confirmUrl: string
  /** Optional intro line — defaults to a generic welcome. Lets the creator
   *  customise the confirmation copy later if they want. */
  introLine?: string
}): { html: string; text: string } {
  const brand = opts.brandName || 'this newsletter'
  const intro = opts.introLine
    || `One last step — confirm your subscription to ${brand} so you start getting the issues.`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Confirm your subscription</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;background:#ffffff;border-radius:14px;padding:36px 32px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
        <tr><td>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#1d1d1f;">Confirm your subscription</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#3a3a3c;">${intro}</p>
          <p style="margin:0 0 28px;">
            <a href="${opts.confirmUrl}" style="display:inline-block;padding:12px 22px;background:#0071e3;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">Confirm subscription</a>
          </p>
          <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6e6e73;">If the button doesn't work, paste this link in your browser:</p>
          <p style="margin:0 0 22px;font-size:12px;line-height:1.5;color:#6e6e73;word-break:break-all;"><a href="${opts.confirmUrl}" style="color:#0071e3;text-decoration:none;">${opts.confirmUrl}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#86868b;">Didn't sign up? You can safely ignore this email — without confirming, you won't receive anything.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  const text = `Confirm your subscription

${intro}

Confirm here: ${opts.confirmUrl}

Didn't sign up? You can safely ignore this email — without confirming, you won't receive anything.`
  return { html, text }
}
