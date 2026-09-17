// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A LINK WITHOUT A SCHEME IS A LINK TO YOUR OWN SITE.
//
// A creator types `instagram.com/theirhandle` into the Instagram field, because
// that is how people write a profile. Put that straight into an href and the
// browser reads it as a RELATIVE path, so from the About page it resolves to
// `/about-mvp-demo/instagram.com` and 404s.
//
// Measured, from one creator's Search Console export of 586 not-found URLs:
//
//   /about-mvp-demo/instagram.com
//   /about-mvp-demo/facebook.com
//   /about-mvp-demo/pinterest.com
//   /about-mvp-demo/x.com
//   /about-mvp-demo/tiktok.com
//   /about-mvp-demo/youtube.com
//
// Six dead links on the page whose whole job is to prove a real person is
// behind the site, and Google crawled every one of them.
//
// The footer template already did this correctly:
//
//   var href = s.url.startsWith('http') ? s.url : 'https://' + s.url
//
// and the About template did not. Same rule, two templates, one of them wrong,
// which is the drift this file exists to stop. Both call it now.
//
// mailto: and tel: are left alone. Prefixing those with https:// would break a
// contact link to fix a social one.

/** Schemes that are already absolute and must never be rewritten. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Protocol-relative (//example.com) is absolute too, just inheriting ours. */
const PROTOCOL_RELATIVE = /^\/\//

/**
 * Make a creator-typed link absolute, so it points where they meant.
 *
 * Returns null for anything empty, so a caller can drop the link entirely
 * rather than render an anchor pointing at nothing.
 */
export function absoluteUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  // Already absolute, or a scheme we must not touch (mailto:, tel:).
  if (HAS_SCHEME.test(s)) return s
  if (PROTOCOL_RELATIVE.test(s)) return `https:${s}`

  // A bare email typed into a link field. Common enough to be worth catching:
  // https://someone@example.com is not a thing.
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return `mailto:${s}`

  // A deliberate site-relative path stays relative. Somebody linking /about/
  // means their own /about/, and making that https://about/ would be worse
  // than leaving it.
  if (s.startsWith('/')) return s

  return `https://${s}`
}
