// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pure ASIN parsing, with NO imports.
//
// This lives apart from lib/product-link.ts on purpose. That module reaches for
// the Amazon service and the SSRF guard, and the guard pulls in Node's
// `dns/promises`. Importing the one-line parser from a client component
// therefore dragged a Node-only module into the browser bundle (a real build
// warning) plus the whole Amazon service with it. Client code imports this file;
// product-link re-exports it so every server caller is untouched.

/** Pull a 10-char Amazon ASIN out of an Amazon product URL path.
 *
 *  /clp/ is in the list because Amazon puts it there. Following a geni.us link
 *  server-side lands on /dp/<ASIN>?tag=…, and Amazon then redirects that request
 *  onward to https://www.amazon.com/clp/<ASIN> — same product, same id, a path
 *  this parser did not know. The caller read null, concluded it could not tell
 *  which product the post was about, and refused to re-point a post whose ASIN
 *  was sitting in the URL it had just been handed.
 *
 *  The lesson is the shape of the list, not the one missing entry: Amazon has
 *  many paths that carry an ASIN and it adds more. So there is a second pass
 *  below for a path segment that simply IS an ASIN, which catches the next one
 *  without anybody having to find it the hard way. */
export function asinFromAmazonUrl(url: string): string | null {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product|clp)\/([A-Z0-9]{10})(?:[/?]|$)/i)
  if (m) return m[1].toUpperCase()

  // Fallback: an Amazon URL whose path contains a bare ASIN segment. Deliberately
  // narrow. It requires an amazon host, so a random 10-character segment on some
  // other site can never be read as a product, and it requires the B0-prefixed
  // modern ASIN form rather than any 10 alphanumerics, so a slug or a tracking id
  // does not qualify.
  try {
    const u = new URL(url)
    if (!/(?:^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return null
    for (const seg of u.pathname.split('/')) {
      if (/^B0[A-Z0-9]{8}$/i.test(seg)) return seg.toUpperCase()
    }
  } catch { /* not a URL — nothing to read */ }
  return null
}

/** Accept a bare ASIN or any Amazon product link and return the clean 10-char
 *  code, or null. The shared normalizer for every "paste an ASIN or a link"
 *  field, so they all behave identically. */
export function normalizeAsinInput(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  return asinFromAmazonUrl(s)
}
