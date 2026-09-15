// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// THE CURRENT YEAR NEVER APPEARS IN A GENERATED TITLE.
//
// Standing rule. A published post read:
//
//   "Back to School sale Deal: Kismile Nugget Ice Maker Countertop,
//    33LBS/24H Ice... (2026)"
//
// with the slug ".../back-to-school-kismile-...-2026/". Nothing in the codebase
// appends a year: no title builder calls getFullYear(), and the one test that
// bans the pattern (scripts/test-pricing-copy) only greps SOURCE, so a model
// that writes "(2026)" of its own accord sails straight past it. Prompt rules
// alone have never held for the other bans either, which is why scrubBanned
// exists. This is the same idea for titles.
//
// THE HARD PART IS NOT STRIPPING TOO MUCH. On the very same screen:
//
//   "Snailax 2026 Upgraded Neck and Back Massager"
//
// where 2026 is the manufacturer's model year and part of the product's actual
// name. Removing it would corrupt the product, break the match between the post
// and the listing, and look like a bug to the creator.
//
// So this only removes a year used as DECORATION, which is a recognisable
// shape:
//
//   parenthesised anywhere        "Best Ice Makers (2026)"
//   trailing, after a separator   "Best Ice Makers - 2026"  "...: 2026"
//   trailing, bare                "Best Ice Makers 2026"
//   a trailing "in/for/of" phrase "The Best Ice Makers for 2026"
//   LEADING                       "2026 Ice Maker Buying Guide"
//   the Edition idiom             "Best Ice Makers 2026 Edition"
//
// A year sitting mid-title surrounded by words is left alone, which is what
// saves the Snailax case. That is a deliberate trade: a title that genuinely
// ENDS with a model year loses it. Titles end with the product type or a hook,
// not a model year, so the trade is heavily one-sided; and being slightly too
// cautious in the middle is much cheaper than mangling a product name.
//
// Only years NEAR NOW are candidates. A 4-digit number outside that window is
// far likelier to be part of a product name than an SEO year stamp.

/** How far around "now" a 4-digit number is treated as a year stamp. */
const YEARS_BACK = 1
const YEARS_FORWARD = 2

/** The years this would strip, given a reference date. */
export function candidateYears(now: Date = new Date()): number[] {
  const y = now.getUTCFullYear()
  const out: number[] = []
  for (let i = y - YEARS_BACK; i <= y + YEARS_FORWARD; i++) out.push(i)
  return out
}

/** Tidy the wreckage a removal leaves: doubled spaces, orphaned separators,
 *  empty brackets, a title that now ends on a colon or a dash. */
function tidy(s: string): string {
  return s
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')   // emptied brackets
    .replace(/\s{2,}/g, ' ')                     // doubled spaces
    .replace(/\s+([,;:.!?])/g, '$1')             // space before punctuation
    .replace(/([([{])\s+/g, '$1')                // space after an opening bracket
    .replace(/\s+([)\]}])/g, '$1')               // space before a closing bracket
    .replace(/[\s|·•]*[-–—:|]\s*$/g, '')         // a separator left dangling at the end
    .replace(/[\s,;:]+$/g, '')                   // trailing punctuation
    .replace(/^[\s,;:|\-–—]+/g, '')              // and at the start
    .trim()
}

/**
 * Remove a decorative year from a TITLE. Never call this on body copy: a year
 * in a sentence ("prices rose through 2026") is legitimate and this is not the
 * layer that should be touching it.
 *
 * `now` is injectable so the behaviour is testable at a fixed date; the rule is
 * about the CURRENT year, so the live default is correct.
 */
export function stripTitleYear(input: string | null | undefined, now: Date = new Date()): string {
  const raw = String(input ?? '')
  if (!raw.trim()) return ''
  const years = candidateYears(now).join('|')
  let s = raw

  // 1. Bracketed anywhere. Always decoration; no product name is "(2026)".
  s = s.replace(new RegExp(`[([{]\\s*(?:${years})\\s*[)\\]}]`, 'g'), ' ')

  // 2a. LEADING. A title that opens on a bare year is the SEO stamp; a model
  //     year belongs after the brand ("Snailax 2026"), never before it.
  s = s.replace(new RegExp(`^\\s*[([{]?\\s*(?:${years})\\s*[)\\]}]?[\\s:,\\-–—|]+`), '')

  // 2b. The "<year> Edition / Update / Roundup" idiom, which is decoration
  //     wrapped around a year. Removing only the year leaves "Best Ice Makers
  //     Edition", so the whole phrase goes.
  s = s.replace(new RegExp(`[\\s|·•]*[-–—:|]?\\s*\\b(?:${years})\\s+(?:Edition|Update|Roundup)\\b`, 'gi'), ' ')

  // 2. A trailing "in / for / of <year>" phrase.
  s = s.replace(new RegExp(`\\b(?:in|for|of)\\s+(?:${years})\\s*$`, 'i'), ' ')

  // 3. A trailing year, with or without a separator before it. Anchored to the
  //    END, which is what keeps a mid-title model year ("Snailax 2026 Upgraded
  //    …") out of reach.
  s = s.replace(new RegExp(`[\\s|·•]*[-–—:|]?\\s*(?:${years})\\s*$`), ' ')

  // 4. And once more for a title that carried two ("Best X 2026 (2026)").
  s = s.replace(new RegExp(`[\\s|·•]*[-–—:|]?\\s*(?:${years})\\s*$`), ' ')

  const out = tidy(s)
  // Never hand back an empty or near-empty title. A title that was ONLY a year
  // is broken either way, and the original at least says something.
  return out.length >= 3 ? out : raw.trim()
}

/** Does this title still carry a year we would have stripped? For tests and
 *  for any surface that wants to report rather than silently rewrite. */
export function hasDecorativeYear(input: string | null | undefined, now: Date = new Date()): boolean {
  const raw = String(input ?? '')
  return raw.trim().length > 0 && stripTitleYear(raw, now) !== raw.trim()
}

/**
 * The same removal for a URL slug, where the year arrives already hyphenated
 * ("...-24h-ice-2026"). Only a TRAILING year segment, for the same reason as
 * above: "snailax-2026-upgraded-massager" keeps its model year.
 */
export function stripSlugYear(input: string | null | undefined, now: Date = new Date()): string {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  const years = candidateYears(now).join('|')
  const out = raw
    .replace(new RegExp(`-(?:${years})$`), '')
    .replace(/-+$/, '')
  return out.length >= 3 ? out : raw
}
