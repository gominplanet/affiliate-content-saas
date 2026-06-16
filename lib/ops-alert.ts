// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Best-effort OPERATOR alert: founder email (Resend) + Discord ping. For the
// rare, high-signal failures the operator must hear about immediately — a
// generation-failure spike, a Stripe tier-write failure — rather than having to
// remember to open a dashboard. Both channels are best-effort: alerting must
// NEVER throw into the caller's path (a publish/webhook handler), so everything
// is wrapped and swallowed. Reuses the same primitives the support-ticket alert
// already uses (sendEmail + notifyDiscord), so it ships inert until RESEND /
// DISCORD_WEBHOOK_URL are configured.

import { sendEmail, isEmailConfigured } from '@/services/email'
import { notifyDiscord } from '@/lib/discord'

function founderEmail(): string {
  return process.env.SUPPORT_ALERT_EMAIL || 'gominunlimited@gmail.com'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/**
 * Fire a one-line operator alert with optional detail. Never throws. Sends to
 * both the founder email and Discord when each is configured; a hiccup on
 * either channel is swallowed.
 */
export async function alertOps(subject: string, detail = ''): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
  try {
    await Promise.allSettled([
      isEmailConfigured()
        ? sendEmail({
            to: founderEmail(),
            subject: `[MVP ops] ${subject}`,
            text: `${subject}\n\n${detail}\n\nAdmin: ${appUrl}/admin`,
            html:
              `<p><strong>${escapeHtml(subject)}</strong></p>` +
              (detail ? `<p style="white-space:pre-wrap">${escapeHtml(detail)}</p>` : '') +
              `<p><a href="${appUrl}/admin">Open admin →</a></p>`,
          })
        : Promise.resolve(),
      notifyDiscord(`🚨 **MVP ops** — ${subject}${detail ? `\n${detail}` : ''}`),
    ])
  } catch {
    /* alerting is best-effort — never block or break the caller */
  }
}
