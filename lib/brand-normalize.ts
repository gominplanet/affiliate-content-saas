// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand-name normalization for MATCHING across sources — the creator's Amazon
// storefront brands, their TikTok brands, and an external list (e.g. TRYBE's
// "Discover Brands"). The goal is a stable key so "Physician's Choice",
// "Physicians Choice" and "PHYSICIAN'S CHOICE LLC" all collapse to one match,
// WITHOUT being so aggressive that two different brands merge. Conservative:
// exact normalized-key equality is the match; we don't fuzzy-merge distinct names.

// Legal / storefront scaffolding words that aren't part of the real brand.
const STRIP_WORDS = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'brand', 'brands',
  'official', 'store', 'shop', 'the', 'usa', 'us',
])

/** A stable lookup key for a brand name: lowercased, de-punctuated, scaffolding
 *  words dropped, spaces removed. '' when nothing usable remains. */
export function brandKey(raw: string | null | undefined): string {
  const s = (raw || '').toLowerCase()
  if (!s) return ''
  // Split into word tokens on non-alphanumerics (handles "&", "'", "-", ".", spaces).
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean).filter((t) => !STRIP_WORDS.has(t))
  return tokens.join('')
}

/** A display-friendly cleanup that KEEPS the readable name (title-ish), only
 *  trimming trailing legal/store scaffolding. Used for what we show, while
 *  brandKey() is used for matching. */
export function brandDisplay(raw: string | null | undefined): string {
  let s = (raw || '').replace(/\s+/g, ' ').trim()
  s = s.replace(/\b(inc|llc|ltd|co|corp|corporation|company)\.?$/i, '').trim()
  s = s.replace(/\bofficial store$/i, '').replace(/\bstore$/i, '').trim()
  s = s.replace(/^the\s+/i, '').trim()
  return s.replace(/[,·|]+$/, '').trim()
}

/** Do two brand names refer to the same brand (by normalized key)? */
export function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = brandKey(a), kb = brandKey(b)
  return !!ka && ka === kb
}
