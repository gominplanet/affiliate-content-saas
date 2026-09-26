// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What makes mvpl.ink a domain a platform reviewer can trust.
//
// Pinterest blocked an mvpl.ink pin as "may lead to spam". Nothing about the
// redirect itself caused that: it is already a plain server 302 straight to the
// retailer, with no page in between and no script. What Pinterest and every
// other spam filter weigh is whether the domain is OPERATED: can anyone see
// where a link goes before clicking it, is there a published rule for what may
// be linked, and does a report actually switch a bad link off. geni.us has had
// years to build that record. This module is the pure half of building ours:
//
//   - the preview address (mvpl.ink/CODE+), which shows where a link goes
//     without going there, the same convention bit.ly uses
//   - the paths on mvpl.ink that are pages, not link codes
//   - what a report may say, and how it is read
//
// Kept pure so the rules are tested rather than buried in a route.

/** Pages served on the short domain itself. Each has a hyphen, which a link
 *  code (plain base62) can never have, so no existing link can collide. */
export const LINK_DOMAIN_PAGES = ['/link-policy', '/report-a-link'] as const
/** Where the report form posts. On the short domain too, so the form works
 *  there with no script and no cross-site request. */
export const LINK_REPORT_API = '/api/link-report'

/** Is this path on the short domain one of its pages (or the report API)? */
export function isLinkDomainPage(pathname: string): boolean {
  const p = String(pathname || '').replace(/\/+$/, '') || '/'
  return (LINK_DOMAIN_PAGES as readonly string[]).includes(p) || p === LINK_REPORT_API
}

/**
 * The code in a preview address, or null. "x7kQ2+" (and its encoded form
 * "x7kQ2%2B") is the preview of x7kQ2. Anything else is not a preview.
 */
export function previewCode(segment: string): string | null {
  let s = String(segment || '')
  try { s = decodeURIComponent(s) } catch { /* keep the raw segment */ }
  const m = /^([A-Za-z0-9]{4,16})\+$/.exec(s)
  return m ? m[1] : null
}

export const LINK_REPORT_REASONS = [
  { key: 'not_product', label: 'It does not go to the product it was shared for' },
  { key: 'spam', label: 'It was posted as spam' },
  { key: 'unsafe', label: 'It goes somewhere unsafe (malware, phishing, a scam)' },
  { key: 'misleading', label: 'The post around it is misleading or has no disclosure' },
  { key: 'other', label: 'Something else' },
] as const
export type LinkReportReason = typeof LINK_REPORT_REASONS[number]['key']

export interface LinkReportInput {
  link?: unknown
  reason?: unknown
  details?: unknown
  email?: unknown
}

export type LinkReportVerdict =
  | { ok: true; code: string; reason: LinkReportReason; details: string | null; email: string | null }
  | { ok: false; error: 'no_code' | 'no_reason' }

/**
 * Read a report. The link may be pasted as the full URL (either shape, with or
 * without the preview "+"), or as the bare code. Pure.
 */
export function readLinkReport(input: LinkReportInput): LinkReportVerdict {
  const code = codeFromReportedLink(String(input.link ?? ''))
  if (!code) return { ok: false, error: 'no_code' }
  const reason = String(input.reason ?? '')
  if (!LINK_REPORT_REASONS.some((r) => r.key === reason)) return { ok: false, error: 'no_reason' }
  const details = String(input.details ?? '').trim().slice(0, 1000) || null
  const rawEmail = String(input.email ?? '').trim().slice(0, 200)
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null
  return { ok: true, code, reason: reason as LinkReportReason, details, email }
}

/** A code out of whatever a reporter pasted. */
export function codeFromReportedLink(raw: string): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  const bare = previewCode(s) || (/^[A-Za-z0-9]{4,16}$/.test(s) ? s : null)
  if (bare) return bare
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] === 'go' && parts[1]) return /^[A-Za-z0-9]{4,16}$/.test(parts[1]) ? parts[1] : null
  if (host === 'mvpl.ink' && parts.length === 1) {
    const seg = parts[0]
    return previewCode(seg) || (/^[A-Za-z0-9]{4,16}$/.test(seg) ? seg : null)
  }
  return null
}

/** What the preview page says a link leads to. Pure, from the stored row. */
export function describeLinkTarget(link: { asin?: string | null; destination_url?: string | null; label?: string | null }): {
  kind: 'amazon' | 'store' | 'unknown'
  /** The store as a visitor would recognise it: "Amazon", or a host name. */
  store: string
  /** A plain address a visitor can read, not the tagged one. */
  address: string | null
  product: string | null
} {
  const product = String(link.label ?? '').trim().slice(0, 160) || null
  const asin = String(link.asin ?? '').trim().toUpperCase()
  if (/^[A-Z0-9]{10}$/.test(asin)) {
    return { kind: 'amazon', store: 'Amazon', address: `amazon.com/dp/${asin}`, product }
  }
  const dest = String(link.destination_url ?? '').trim()
  if (dest) {
    try {
      const u = new URL(dest)
      const host = u.hostname.replace(/^www\./, '')
      return { kind: 'store', store: host, address: `${host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200), product }
    } catch { /* fall through */ }
  }
  return { kind: 'unknown', store: 'unknown', address: null, product }
}

/** How many reports one address may send in an hour before the form stops
 *  taking them. A real person reports one link; this only stops a flood. */
export const LINK_REPORTS_PER_HOUR = 10
