/**
 * Reviewer Trust Block — top-of-article author byline with photo, name,
 * credibility tagline, and optional link.
 *
 * Why this matters:
 *   - E-E-A-T signal for Google (who's actually reviewing? what's their
 *     experience?) — measurable ranking lift on YMYL-adjacent reviews
 *   - Tells AI Overviews / SGE who to attribute the review to
 *   - Reduces bounce by humanizing the page (especially vs ghost-written
 *     content from competitors)
 *
 * Implementation: post-process injection at the TOP of the post body,
 * before the Quick Verdict. Configured per-user in /customize → Reviewer
 * Trust Block; defaults pulled from brand_profiles.
 */

export interface AuthorBlockOptions {
  enabled: boolean
  name: string
  tagline: string
  photoUrl: string
  linkUrl: string
  linkLabel: string
}

/**
 * Render the trust block HTML. Returns empty string when disabled or when
 * we don't have at minimum a name + tagline (no point showing an empty
 * shell — that hurts trust more than it helps).
 */
export function renderAuthorBlock(opts: AuthorBlockOptions): string {
  if (!opts.enabled) return ''
  const name = (opts.name || '').trim()
  const tagline = (opts.tagline || '').trim()
  if (!name || !tagline) return ''

  const photo = (opts.photoUrl || '').trim()
  const link = (opts.linkUrl || '').trim()
  const linkLabel = (opts.linkLabel || 'More about me').trim()

  // Inline styles for theme-independent rendering. Mobile-friendly via
  // flex-wrap + max-widths.
  return [
    '<!-- wp:html -->',
    '<div class="gr-author-block" style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;margin:0 0 24px;border:1px solid #e5e5e7;border-left:4px solid #FFC200;border-radius:6px;background:#fafafa">',
    photo
      ? `  <img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" loading="lazy" style="flex-shrink:0;width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.1)" />`
      : '',
    '  <div style="flex:1;min-width:0">',
    `    <p style="margin:0;font-size:11px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:.8px">Reviewed by</p>`,
    `    <p style="margin:2px 0 6px;font-size:15px;font-weight:700;color:#1d1d1f;line-height:1.2">${escapeHtml(name)}</p>`,
    `    <p style="margin:0;font-size:13px;color:#3a3a3c;line-height:1.5">${escapeHtml(tagline)}${link ? ` <a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:#0071e3;text-decoration:none;font-weight:600;white-space:nowrap">${escapeHtml(linkLabel)} →</a>` : ''}</p>`,
    '  </div>',
    '</div>',
    '<!-- /wp:html -->',
  ].filter(Boolean).join('\n')
}

/**
 * Inject the author block at the top of the post body — right before the
 * Quick Verdict box. Idempotent (won't double-stack on rebuild).
 */
export function injectAuthorBlock(content: string, opts: AuthorBlockOptions): string {
  const block = renderAuthorBlock(opts)
  if (!block) return content
  if (content.includes('class="gr-author-block"')) return content

  // Insert right before the Quick Verdict opening div. If no verdict
  // (story-format posts), insert at the very top of the body.
  const verdictIdx = content.indexOf('class="gr-verdict-box"')
  if (verdictIdx === -1) {
    return block + '\n\n' + content
  }
  const divStart = content.lastIndexOf('<div', verdictIdx)
  if (divStart === -1) return block + '\n\n' + content

  // If a wp:html comment precedes the verdict, insert before that comment
  // so the block isn't sandwiched between the comment and the div.
  const wpHtmlOpen = content.lastIndexOf('<!-- wp:html -->', divStart)
  const insertAt = (wpHtmlOpen !== -1 && wpHtmlOpen > divStart - 100) ? wpHtmlOpen : divStart

  return content.slice(0, insertAt) + block + '\n\n' + content.slice(insertAt)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
