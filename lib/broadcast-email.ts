// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Renders an operator broadcast into a clean, inbox-friendly HTML email.
// The composer types plain text (blank line = new paragraph); we escape it,
// turn bare URLs into links, and wrap it in a minimal branded shell with the
// legally-required unsubscribe footer + mailing address.

const BRAND = 'MVP Affiliate'
const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
// CAN-SPAM requires a physical postal address in marketing email. Set
// COMPANY_MAILING_ADDRESS in env; falls back to a clearly-placeholder line
// so a misconfig is obvious in the footer rather than silently missing.
const MAILING_ADDRESS = process.env.COMPANY_MAILING_ADDRESS || 'MVP Affiliate — mailing address not set'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Escape, then auto-link bare http(s) URLs, then paragraph/line-break. */
function bodyToHtml(text: string): string {
  const esc = escapeHtml((text || '').trim())
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[.,!?;:)]+$/, '') // don't swallow trailing punctuation
    const tail = url.slice(clean.length)
    return `<a href="${clean}" style="color:#7C3AED;text-decoration:underline">${clean}</a>${tail}`
  })
  return linked
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6;font-size:15px;color:#1d1d1f">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function renderBroadcastText(bodyText: string, unsubscribeUrl: string): string {
  return `${(bodyText || '').trim()}\n\n—\n${BRAND}\nUnsubscribe: ${unsubscribeUrl}\n${MAILING_ADDRESS}`
}

export function renderBroadcastHtml(opts: {
  subject: string
  bodyText: string
  unsubscribeUrl: string
  preheader?: string
}): string {
  const { subject, bodyText, unsubscribeUrl, preheader } = opts
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e5ea">
        <tr><td style="padding:22px 28px 8px">
          <span style="font-size:15px;font-weight:700;color:#7C3AED;letter-spacing:-0.01em">${BRAND}</span>
        </td></tr>
        <tr><td style="padding:8px 28px 4px">
          <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#1d1d1f;font-weight:700;letter-spacing:-0.02em">${escapeHtml(subject)}</h1>
          ${bodyToHtml(bodyText)}
        </td></tr>
        <tr><td style="padding:20px 28px 26px">
          <hr style="border:none;border-top:1px solid #e5e5ea;margin:0 0 14px">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#86868b">
            You're receiving this because you have an ${BRAND} account.
            <a href="${unsubscribeUrl}" style="color:#86868b;text-decoration:underline">Unsubscribe from these emails</a>.<br>
            ${escapeHtml(MAILING_ADDRESS)} · <a href="${APP_BASE}" style="color:#86868b;text-decoration:underline">${APP_BASE.replace(/^https?:\/\//, '')}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── 1:1 direct messages (admin → one user) ────────────────────────────────
//
// Deliberately NOT the broadcast shell. A broadcast is marketing: it carries
// "you're receiving this because you have an account" plus an unsubscribe
// link, and it must, because it's a bulk send people opted into.
//
// A direct message is a service reply about that person's own account ("your
// Telegram is fixed", "your X connection expired"). Offering to unsubscribe
// from THAT is wrong twice over: it invites someone to switch off the notices
// they most need, and it makes a personal reply read like a mailing list.
// Same branded shell, honest footer, reply-to points at a human.

export function renderDirectText(bodyText: string, replyTo: string): string {
  return `${(bodyText || '').trim()}\n\n—\n${BRAND}\nReply to this email to reach us directly${replyTo ? ` (${replyTo})` : ''}.`
}

export function renderDirectHtml(opts: {
  subject: string
  bodyText: string
  replyTo?: string
  preheader?: string
}): string {
  const { subject, bodyText, replyTo, preheader } = opts
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e5ea">
        <tr><td style="padding:22px 28px 8px">
          <span style="font-size:15px;font-weight:700;color:#7C3AED;letter-spacing:-0.01em">${BRAND}</span>
        </td></tr>
        <tr><td style="padding:8px 28px 4px">
          <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#1d1d1f;font-weight:700;letter-spacing:-0.02em">${escapeHtml(subject)}</h1>
          ${bodyToHtml(bodyText)}
        </td></tr>
        <tr><td style="padding:20px 28px 26px">
          <hr style="border:none;border-top:1px solid #e5e5ea;margin:0 0 14px">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#86868b">
            This is a message about your ${BRAND} account — just hit reply to reach us${replyTo ? ` at ${escapeHtml(replyTo)}` : ''}.<br>
            <a href="${APP_BASE}" style="color:#86868b;text-decoration:underline">${APP_BASE.replace(/^https?:\/\//, '')}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
