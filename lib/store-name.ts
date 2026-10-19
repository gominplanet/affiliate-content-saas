// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHERE A LINK GOES, IN A CUSTOMER'S WORDS (Seb, 2026-10-19: "any hyperlink
// that a customer may see and may click on, they need to know where they're
// going to end up. So if it's an Amazon link, it needs to say click here to
// find on Amazon ... Same thing if we sent them to Walmart, or to Best Buy").
//
// One answer for every place MVP writes a link a customer sees: a button, a
// row, a caption line. The store comes from the address first (the widest
// list is lib/link-in-bio's), then an ASIN, which is always Amazon. A short
// link (Passport, Geniuslink, Bitly) hides the store in its address, so it is
// null here unless an ASIN says Amazon: the caller then has to know the store
// another way (lib/link-store follows the link) rather than guess. Any other
// address names its own site ("brand.com"), which still says where it goes.
// Pure. scripts/test-link-words.ts holds every surface to it.

import { retailerForItem } from '@/lib/link-in-bio'

/** Addresses that hide where they lead. */
export const HIDES_STORE = /(^|\.)(geni\.us|mvpl\.ink|bit\.ly|bitly\.com|tinyurl\.com|rebrand\.ly|t\.co|ow\.ly|lnk\.to|linktr\.ee|shorturl\.at|cutt\.ly)$/i

/** The store a link leads to, or null when its address hides it and no ASIN
 *  says Amazon. */
export function storeOf(url: string | null | undefined, asin?: string | null): string | null {
  const u = String(url || '').trim()
  const known = retailerForItem({ url: u, asin: null, source: null })
  if (known) return known
  let host = ''
  try { host = new URL(u).hostname.replace(/^www\./i, '').toLowerCase() } catch { host = '' }
  if (host && !HIDES_STORE.test(host)) return host
  return asin ? 'Amazon' : null
}

/** "Check today's price on Amazon", naming the store when it is known. */
export function priceCta(store: string | null | undefined): string {
  return store ? `Check today's price on ${store}` : 'Check today’s price'
}

/** "See it on Walmart", for a short row or a caption. */
export function seeItOn(store: string | null | undefined): string {
  return store ? `See it on ${store}` : 'See it here'
}
