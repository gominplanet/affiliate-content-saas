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

/** Pull a 10-char Amazon ASIN out of an Amazon product URL path. */
export function asinFromAmazonUrl(url: string): string | null {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)
  return m ? m[1].toUpperCase() : null
}

/** Accept a bare ASIN or any Amazon product link and return the clean 10-char
 *  code, or null. The shared normalizer for every "paste an ASIN or a link"
 *  field, so they all behave identically. */
export function normalizeAsinInput(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  return asinFromAmazonUrl(s)
}
