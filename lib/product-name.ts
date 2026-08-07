// Turn a messy Amazon product title into a clean, searchable name.
//
// Amazon titles are keyword-stuffed ("Xprite 42 LED Rooftop Beacon Strobe Light
// Bar Emergency Warning Hazard Flashing Snowplow Lights w/Controller for
// Construction Vehicles Towing Work Trucks Plows Pickup-Blue"). Shoppers search
// the BRAND + a short core name ("Xprite 42 LED Rooftop Beacon Strobe Light
// Bar"), and AI/Google match on that. This distills the raw title into:
//
//   { brand, shortName, canonical, fullTitle }
//
// so titles, headings, taglines, the SEO keyword and the first in-article
// mention can all use the same clean name, while the full title is kept for one
// exact-match mention + specs.

export interface ProductName {
  /** Clean brand, e.g. "Xprite" (never "Xprite Store"). '' if unknown. */
  brand: string
  /** Short core name WITHOUT the brand, e.g. "42 LED Rooftop Beacon Strobe Light Bar". */
  shortName: string
  /** brand + shortName, e.g. "Xprite 42 LED Rooftop Beacon Strobe Light Bar". */
  canonical: string
  /** The original raw title, untouched (for one exact mention + a specs line). */
  fullTitle: string
}

// Trailing words Amazon appends to a storefront that are NOT part of the brand
// ("Xprite Store", "Xprite Official Store"). Stripped from the end, repeatedly.
const BRAND_TAIL = /[\s\-–—]+(store|shop|official|storefront|outlet|boutique|direct|us|usa|global)\s*$/i

/**
 * Clean a brand string: drop "Visit the … Store" scaffolding, the trailing
 * "Store"/"Shop"/"Official" that Amazon appends, trademark glyphs, and extra
 * punctuation. Preserves the brand's real casing ("Xprite", "LG", "GoPro").
 */
export function cleanBrand(raw: string | null | undefined): string {
  let s = (raw || '').trim()
  if (!s) return ''
  // "Visit the Xprite Store" / "Brought to you by Xprite" → strip the framing.
  s = s.replace(/^\s*(?:visit(?:\s+the)?|brought\s+to\s+you\s+by|shop|by)\s+/i, '')
  // Trademark / registered / copyright glyphs.
  s = s.replace(/[®™©]/g, '')
  // Strip a trailing noise word, repeatedly ("Xprite Official Store" → "Xprite").
  let prev: string
  do { prev = s; s = s.replace(BRAND_TAIL, '').trim() } while (s !== prev && s.length > 0)
  return s.replace(/\s{2,}/g, ' ').replace(/[|,\-–—/]+$/g, '').trim()
}

// Tokens that mark the END of the core product name — everything from here on is
// use-case / marketing / keyword stuffing. Cut the short name BEFORE the first
// one that appears.
// Deliberately ONLY use-case / scenario / gifting words that reliably mark the
// end of the core name. Descriptive adjectives (high, portable, wireless,
// waterproof, premium, professional…) are intentionally NOT here — they're
// often part of the real product name ("High Speed RC Car", "Wireless Charger"),
// so cutting on them truncates good names. Length is bounded by maxWords instead.
const CUT_WORDS = new Set([
  'emergency', 'warning', 'hazard', 'flashing', 'compatible', 'universal',
  'ideal', 'perfect', 'multifunctional', 'gift', 'gifts', 'great',
])

// Connector words: the name ends before "… for X", "… with Y", "w/ Z",
// "… by <manufacturer>" (common on supplements: "Cortisol Manager by
// Integrative Therapeutics").
const CONNECTORS = /\b(for|with|w\/|featuring|fits|includes|including|to|by)\b/i

/**
 * Distil a raw Amazon title into a clean product name.
 *
 * @param rawTitle  the full Amazon/scraped title
 * @param brand     an authoritative brand if known (e.g. Keepa's `brand`); it's
 *                  cleaned and preferred over guessing from the title.
 * @param maxWords  cap on the short-name word count (default 7) so titles built
 *                  from `canonical` stay short.
 */
export function deriveProductName(
  rawTitle: string | null | undefined,
  brand?: string | null,
  maxWords = 7,
): ProductName {
  const fullTitle = (rawTitle || '').trim()
  if (!fullTitle) return { brand: cleanBrand(brand), shortName: '', canonical: cleanBrand(brand), fullTitle: '' }

  // 1. Brand: prefer the given one (cleaned); else take leading token(s) before
  //    the first number/spec word.
  let cleanedBrand = cleanBrand(brand)
  if (!cleanedBrand) {
    const m = fullTitle.match(/^([A-Za-z][A-Za-z0-9&'.\-]*(?:\s+[A-Z][A-Za-z0-9&'.\-]*){0,1})\b/)
    // Guard: don't grab a leading number/spec as the "brand".
    if (m && !/^\d/.test(m[1])) cleanedBrand = cleanBrand(m[1])
  }

  // 2. Strip the brand prefix from the title (case-insensitive) to get the tail.
  let tail = fullTitle
  if (cleanedBrand) {
    const bp = new RegExp('^\\s*' + cleanedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s\\-–—:]*', 'i')
    tail = fullTitle.replace(bp, '').trim()
  }

  // 3. Cut at the first hard separator ( |  ,  (  ;  :  / ), the first connector
  //    word, or the first CUT_WORD — whichever comes first.
  const sepIdx = ((): number => {
    const m = tail.match(/[|(;:/]|,| [–—-] /)
    return m && m.index != null ? m.index : -1
  })()
  if (sepIdx >= 0) tail = tail.slice(0, sepIdx)

  const words = tail.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const bare = w.toLowerCase().replace(/[^a-z/]/g, '')
    if (CONNECTORS.test(w) || CUT_WORDS.has(bare)) break
    out.push(w)
    if (out.length >= maxWords) break
  }
  let shortName = out.join(' ').trim()
  // Trim a trailing colour/variant tail like "Pickup-Blue" or a lone dash.
  shortName = shortName.replace(/[-–—][A-Za-z]+$/,'').replace(/[|,\-–—/]+$/,'').trim()
  // Drop a trailing bare number that leaked from a spec ("… Car 1" from "1:18
  // Scale"). Only when there's still a real name left (≥4 words) so model
  // numbers like "iPhone 15" survive.
  const toks = shortName.split(/\s+/)
  if (toks.length >= 4 && /^\d{1,4}$/.test(toks[toks.length - 1])) { toks.pop(); shortName = toks.join(' ') }

  const canonical = [cleanedBrand, shortName].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim()
  return { brand: cleanedBrand, shortName, canonical: canonical || cleanedBrand || shortName, fullTitle }
}
