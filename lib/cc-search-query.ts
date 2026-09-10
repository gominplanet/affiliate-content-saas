// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Turning what a creator types into something the catalogue can actually match.
//
// Browse searched the catalogue with websearch_to_tsquery, which matches whole
// words only. On a 918,748-row catalogue that reads as a broken search box:
// "humidifier" returns thousands of campaigns and "humid" returns nothing at
// all. Nobody types the whole word before the results are supposed to appear,
// and the search reloads on a 300ms debounce as they type, so almost every
// keystroke on the way to a real word rendered an empty page.
//
// So the LAST token becomes a prefix. "humid" builds humid:* which matches the
// lexeme humidifi that "humidifier" stems to, while earlier tokens stay exact
// because the creator finished typing those. That is the ordinary
// search-as-you-type contract and it costs nothing: the GIN index on search_vec
// serves a prefix match the same way it serves an exact one.
//
// ASINs get their own path. A creator pasting B0FHK9DYTC wants that product's
// campaigns, and full-text search only finds it when Amazon happened to put the
// ASIN in the campaign name. The asins array has its own GIN index and answers
// that question directly.
//
// Pure and import-free: the route builds the query here, and the tests below
// pin the shapes that used to return nothing.

/** A 10-character Amazon ASIN, on its own. CC products are effectively all
 *  B0-prefixed, and requiring that prefix keeps a 10-letter product word like
 *  "humidifier" (10 characters, as it happens) from being read as an ASIN. */
const ASIN_RE = /^B0[A-Z0-9]{8}$/i

/** The pasted ASIN, uppercased, or null. Whitespace is tolerated because this
 *  arrives from a paste as often as from typing. */
export function ccAsinFromQuery(q: string | null | undefined): string | null {
  const s = String(q ?? '').trim()
  return ASIN_RE.test(s) ? s.toUpperCase() : null
}

/** Build a Postgres tsquery with the last token as a prefix.
 *
 *  Returns null when there is nothing searchable, which the caller reads as "no
 *  keyword filter" rather than "match nothing".
 *
 *  Everything that is not a letter or a digit becomes a separator. That is
 *  deliberate and it is the security-relevant part: tsquery has its own syntax
 *  (& | ! : * parentheses) and a raw apostrophe or ampersand from a product
 *  name would otherwise reach to_tsquery as an operator and throw a syntax
 *  error, which the caller would see as a failed search rather than as no
 *  results. Stripping the punctuation makes an injected operator impossible
 *  instead of merely unlikely. */
export function ccTsQuery(q: string | null | undefined): string | null {
  const tokens = String(q ?? '')
    .toLowerCase()
    // \p{L}\p{N} rather than \w so accented brand names survive as words.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    // A long paste is a paste, not a search. Six tokens is more than any real
    // query and it bounds the work the GIN index is asked to do.
    .slice(0, 6)

  if (!tokens.length) return null

  const last = tokens.length - 1
  return tokens
    .map((t, i) => (i === last ? `${t}:*` : t))
    .join(' & ')
}

/** How a query should be run against the catalogue.
 *
 *  'none'   nothing typed, browse everything
 *  'asin'   a pasted ASIN, answered by the asins GIN index
 *  'prefix' the normal case: indexed full text with a prefix on the last word
 */
export type CcSearchMode = 'none' | 'asin' | 'prefix'

export function ccSearchMode(q: string | null | undefined): CcSearchMode {
  if (!String(q ?? '').trim()) return 'none'
  if (ccAsinFromQuery(q)) return 'asin'
  return ccTsQuery(q) ? 'prefix' : 'none'
}

/** Page size for a Browse request. Default 100, up from the 40 that made a
 *  918,748-row catalogue feel like it held a few hundred campaigns. Capped at
 *  200 so a crafted pageSize cannot ask the database for the whole table. */
export const CC_BROWSE_PAGE_DEFAULT = 100
export const CC_BROWSE_PAGE_MAX = 200

export function ccPageSize(v: unknown): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 1) return CC_BROWSE_PAGE_DEFAULT
  return Math.min(CC_BROWSE_PAGE_MAX, n)
}
