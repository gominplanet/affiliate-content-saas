// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Responsive email-safe HTML template for newsletter broadcasts.
//
// Why hand-rolled (and not MJML or React-Email): every modern email
// client renders ~95% of inline-table HTML correctly, and a single
// hand-tuned template gives us complete control over the inline CSS the
// gmail/outlook clipping algorithm cares about. MJML adds a build step;
// React-Email pulls in React + JSX; both feel like overkill for one
// template that's going to be edited maybe once a quarter.
//
// Used by:
//   /api/newsletter/draft  — wraps the Claude-generated section blocks
//                            into the full email shell for the preview
//   /api/newsletter/send   — re-renders per-recipient with a fresh
//                            unsubscribe link (token-scoped per row)

export interface NewsletterBlogPost {
  /** WordPress canonical permalink — the click target. */
  url: string
  title: string
  /** Plain-text excerpt (no HTML). 200-300 chars is the sweet spot. */
  excerpt: string
  /** Featured image URL, ideally landscape ≥ 600px wide. Optional —
   *  the card still renders without one (text-only). */
  imageUrl?: string | null
  /** One short line the AI writes about WHY this post is in the issue.
   *  ("This one's for the campers — we tested 5 portable lanterns…") */
  blurb?: string | null
}

export interface NewsletterCuratedLink {
  url: string
  /** Display label — falls back to a clean URL host if empty. */
  label?: string | null
  /** The "why I recommend it" line the creator typed in compose. */
  blurb: string
}

export interface NewsletterRenderInput {
  /** Subject line — used as the H1 inside the email too. */
  subject: string
  /** AI-written intro paragraph (1-3 sentences). The "hi everyone" line. */
  intro: string
  /** Creator's free-text personal message — surfaced verbatim, between the
   *  intro and the post list. Optional. */
  personalMessage?: string | null
  /** AI-written outro / sign-off — 1-2 sentences. */
  outro: string
  posts: NewsletterBlogPost[]
  curatedLinks: NewsletterCuratedLink[]
  brand: {
    /** Sender display name — "Gomin Reviews". Surfaced in header + footer. */
    name: string
    /** Public site URL — header logo links here. */
    siteUrl?: string | null
    /** Headshot / logo URL. Optional. */
    logoUrl?: string | null
    /** Mailing address — CAN-SPAM requirement, lives in the footer. */
    mailingAddress?: string | null
    /** Author byline + small "from" line below the subject. */
    byline?: string | null
  }
  /** Per-recipient links — these change for every subscriber, so the send
   *  pipeline injects them at send-time (not at draft-time). */
  links: {
    /** /api/newsletter/unsubscribe?token=… for this subscriber. */
    unsubscribeUrl: string
    /** Optional: link to view the same broadcast as a web page. */
    viewInBrowserUrl?: string | null
  }
}

/** Lightweight escaper — runs on every string fed into the template so
 *  the AI can't introduce script tags into the rendered email. */
function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render the per-post card row. Two-column on desktop (image + text),
 *  stacks via CSS attribute on mobile clients that respect it. */
function renderPostCard(p: NewsletterBlogPost): string {
  const img = p.imageUrl
    ? `<a href="${esc(p.url)}" style="text-decoration:none;color:inherit;display:block;">
         <img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" width="560" style="width:100%;max-width:560px;height:auto;border-radius:10px;display:block;border:0;" />
       </a>`
    : ''
  const blurb = p.blurb
    ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#3a3a3c;">${esc(p.blurb)}</p>`
    : ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr><td>
    ${img}
    <h2 style="margin:${p.imageUrl ? '14px' : '0'} 0 8px;font-size:20px;line-height:1.3;color:#1d1d1f;">
      <a href="${esc(p.url)}" style="color:#1d1d1f;text-decoration:none;">${esc(p.title)}</a>
    </h2>
    ${blurb}
    <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#6e6e73;">${esc(p.excerpt)}</p>
    <p style="margin:0;">
      <a href="${esc(p.url)}" style="display:inline-block;padding:9px 16px;background:#0071e3;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Read the review</a>
    </p>
  </td></tr>
</table>`
}

/** Render the curated-links block — short list with the creator's "why".
 *  Distinct visual style from the blog cards so subscribers know these
 *  are external picks, not the host's own posts. */
function renderCuratedLinks(links: NewsletterCuratedLink[]): string {
  if (links.length === 0) return ''
  const labelFor = (l: NewsletterCuratedLink) => {
    if (l.label && l.label.trim()) return l.label.trim()
    try { return new URL(l.url).hostname.replace(/^www\./, '') }
    catch { return l.url }
  }
  const items = links.map(l => `<li style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#3a3a3c;">
    <a href="${esc(l.url)}" style="color:#0071e3;text-decoration:none;font-weight:600;">${esc(labelFor(l))}</a>
    <span style="color:#6e6e73;"> — ${esc(l.blurb)}</span>
  </li>`).join('\n')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;background:#f5f5f7;border-radius:12px;padding:20px 24px;">
  <tr><td>
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#0071e3;">Worth your time this week</p>
    <ul style="margin:0;padding:0 0 0 18px;">${items}</ul>
  </td></tr>
</table>`
}

/** Compliance footer — CAN-SPAM (US) requires brand name + mailing address;
 *  RFC 8058 / Gmail+Yahoo bulk-sender rules require a one-click unsub.
 *  Both surfaced here so every broadcast is compliant by default. */
function renderFooter(input: NewsletterRenderInput): string {
  const addr = input.brand.mailingAddress
    ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#86868b;">${esc(input.brand.mailingAddress)}</p>`
    : ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e5e5ea;padding-top:20px;margin-top:12px;">
  <tr><td align="center">
    <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#3a3a3c;">${esc(input.brand.name)}</p>
    ${addr}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#86868b;">
      <a href="${esc(input.links.unsubscribeUrl)}" style="color:#86868b;text-decoration:underline;">Unsubscribe</a>
      ${input.links.viewInBrowserUrl ? ` &nbsp;·&nbsp; <a href="${esc(input.links.viewInBrowserUrl)}" style="color:#86868b;text-decoration:underline;">View in browser</a>` : ''}
    </p>
  </td></tr>
</table>`
}

/** Build the full email HTML. The shell is a single fixed-width table
 *  (520px) so Outlook + Apple Mail render it consistently. Inline styles
 *  everywhere — Gmail strips <style> blocks. */
export function renderNewsletterHtml(input: NewsletterRenderInput): string {
  const personal = input.personalMessage?.trim()
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;background:#fff8e1;border-left:3px solid #ff9500;border-radius:8px;padding:16px 20px;">
         <tr><td>
           <p style="margin:0;font-size:15px;line-height:1.6;color:#3a3a3c;font-style:italic;">${esc(input.personalMessage)}</p>
         </td></tr>
       </table>`
    : ''
  const byline = input.brand.byline
    ? `<p style="margin:6px 0 0;font-size:13px;color:#86868b;">${esc(input.brand.byline)}</p>`
    : ''
  const logo = input.brand.logoUrl
    ? `<a href="${esc(input.brand.siteUrl || '#')}" style="text-decoration:none;display:inline-block;margin-bottom:14px;"><img src="${esc(input.brand.logoUrl)}" alt="${esc(input.brand.name)}" height="40" style="height:40px;width:auto;border:0;" /></a>`
    : ''
  const postsHtml = input.posts.map(renderPostCard).join('\n')
  const linksHtml = renderCuratedLinks(input.curatedLinks)
  const footer = renderFooter(input)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preheader — shown in the inbox preview line; kept hidden in the body. -->
  <div style="display:none;font-size:1px;color:#f5f5f7;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${esc(input.intro.slice(0, 140))}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
        <tr><td>
          ${logo}
          <h1 style="margin:0 0 6px;font-size:26px;line-height:1.25;color:#1d1d1f;font-weight:700;">${esc(input.subject)}</h1>
          ${byline}
          <p style="margin:18px 0 24px;font-size:15px;line-height:1.6;color:#3a3a3c;">${esc(input.intro)}</p>
          ${personal}
          ${postsHtml}
          ${linksHtml}
          <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#3a3a3c;">${esc(input.outro)}</p>
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Plain-text fallback — every send pipeline should include both, partly
 *  because some clients still default to text, partly because spam
 *  filters give a small boost for multipart/alternative messages. */
export function renderNewsletterText(input: NewsletterRenderInput): string {
  const lines: string[] = []
  lines.push(input.subject)
  lines.push('='.repeat(input.subject.length))
  lines.push('')
  lines.push(input.intro)
  lines.push('')
  if (input.personalMessage?.trim()) {
    lines.push(input.personalMessage.trim())
    lines.push('')
  }
  for (const p of input.posts) {
    lines.push(`## ${p.title}`)
    if (p.blurb) lines.push(p.blurb)
    lines.push(p.excerpt)
    lines.push(`Read: ${p.url}`)
    lines.push('')
  }
  if (input.curatedLinks.length > 0) {
    lines.push('— Worth your time this week —')
    for (const l of input.curatedLinks) {
      lines.push(`• ${l.label || l.url}: ${l.blurb}`)
      lines.push(`  ${l.url}`)
    }
    lines.push('')
  }
  lines.push(input.outro)
  lines.push('')
  lines.push(`— ${input.brand.name}`)
  if (input.brand.mailingAddress) lines.push(input.brand.mailingAddress)
  lines.push('')
  lines.push(`Unsubscribe: ${input.links.unsubscribeUrl}`)
  if (input.links.viewInBrowserUrl) lines.push(`View in browser: ${input.links.viewInBrowserUrl}`)
  return lines.join('\n')
}
