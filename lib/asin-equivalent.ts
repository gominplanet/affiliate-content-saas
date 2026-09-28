// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SAME PRODUCT, UNDER ANOTHER COUNTRY'S ASIN.
//
// Amazon often lists one product under a different ASIN in each store: a router
// that is B091G65HH6 on amazon.com is B091GX3LWR on amazon.ca. Asking "is
// B091G65HH6 sold in Canada?" gets No, and the country was written off as "not
// sold here" for a product Canada sells. The barcode is what the listings
// share, so a product the same ASIN cannot find is looked for again by its
// UPC/EAN in that country's store.

/** Barcodes compared the way stores print them: a UPC-A (12 digits) is the
 *  same number as the EAN-13 with a leading zero, and a GTIN-14 adds another. */
export function normalizeCode(code: string): string {
  const d = String(code || '').replace(/\D/g, '')
  return d.replace(/^0+/, '')
}

/**
 * The local listing for a product, from the listings that share its barcode.
 * Only a listing with a title counts (Keepa returns empty shells), and when
 * several match, the one sharing the most codes wins, then the first. Null
 * when nothing shares a code: guessing by title would tag the wrong product.
 */
export function pickEquivalent(
  sourceCodes: string[],
  candidates: Array<{ asin: string; title: string | null; codes: string[] }>,
  sourceAsin: string,
): string | null {
  const want = new Set(sourceCodes.map(normalizeCode).filter((c) => c.length >= 8))
  if (!want.size) return null
  let best: { asin: string; shared: number } | null = null
  for (const c of candidates) {
    if (!c.title || c.asin.toUpperCase() === sourceAsin.toUpperCase()) continue
    const shared = new Set(c.codes.map(normalizeCode).filter((x) => want.has(x))).size
    if (shared === 0) continue
    if (!best || shared > best.shared) best = { asin: c.asin.toUpperCase(), shared }
  }
  return best?.asin ?? null
}
