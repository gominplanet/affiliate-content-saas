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

  // ── DECORATION THAT SITS MID-TITLE ────────────────────────────────────
  //
  // The rules above only reach a year that is leading, trailing, or alone in
  // brackets. An audit of 37 live titles found 23 of them caught and 12 missed,
  // and every miss was the same shape: decoration in the MIDDLE, in front of a
  // subtitle.
  //
  //   Best Robotic Pool Vacuums in 2026: Beatbot vs ECOVACS
  //   Best All-In-One Pool Cleaners 2026 Guide
  //   Tracki Pro GPS Tracker Review: Worth It in 2025?
  //   Tidify Car Front Seat Organizer [2025 UPDATED]: ...
  //
  // The header above calls leaving the middle alone a deliberate trade, and it
  // was the right one while the rule was "a bare year mid-title". These rules
  // do not change that: a BARE year in the middle is still untouchable, which
  // is what keeps "Snailax 2026 Upgraded Neck and Back Massager" intact. They
  // only fire when the year is ATTACHED to something that makes it decoration:
  // a preposition, a season, a word like Guide, or a subtitle colon on a title
  // that opens with "Best". No product name carries a year in those positions.

  // A. Brackets holding a year plus a decoration word, in either order.
  //    "[2025 UPDATED]" is not matched by rule 1, which wants the year alone.
  const DECOR = 'Updated?|Edition|Guide|Review|Refresh|New|Latest'
  s = s.replace(new RegExp(`[([{]\\s*(?:${years})\\s+(?:${DECOR})\\s*[)\\]}]`, 'gi'), ' ')
  s = s.replace(new RegExp(`[([{]\\s*(?:${DECOR})\\s+(?:${years})\\s*[)\\]}]`, 'gi'), ' ')

  // B. A preposition carrying the year, ANYWHERE, not only at the end. The
  //    preposition goes with it: "Best Vacuums in 2026: 5 Models" should read
  //    "Best Vacuums: 5 Models", not "Best Vacuums in: 5 Models".
  s = s.replace(new RegExp(`\\b(?:in|for|of)\\s+(?:${years})\\b`, 'gi'), ' ')

  // C. A season keeps its name and loses the year. "for Summer 2026" is about
  //    the season; only the stamp is decoration.
  s = s.replace(
    new RegExp(`\\b(early|late|mid|spring|summer|autumn|fall|winter|holiday|christmas|black friday)\\s+(?:${years})\\b`, 'gi'),
    '$1')

  // D. A year in front of a decoration noun, with an optional adjective
  //    between them ("2026 Premium Showdown"). The noun stays; only the year
  //    goes, so the title still says what it is.
  //
  //    TWICE AS NARROW AS THE FIRST ATTEMPT, because the guard caught it. That
  //    version allowed "Review" and "Compared" in the noun list, and with the
  //    optional adjective in between it reached straight across a product name:
  //
  //      "The Ninja 2026 Creami Review"        -> "The Ninja Creami Review"
  //      "Kismile 2026 Ice Maker vs the 2025 Model Compare"  -> lost both
  //
  //    Review is the most common last word on this whole site, so pairing it
  //    with a wildcard adjective made a model year reachable from half the
  //    titles in the database. Two defences now: the noun list holds only words
  //    that are our own roundup furniture, and the whole rule is limited to
  //    titles that open with "Best", which is our phrasing and never a product.
  s = s.replace(
    new RegExp(`^(Best\\b[^:]*?)\\s+(?:${years})\\s+(?=(?:[A-Z][a-z-]+\\s+)?(?:Guide|Showdown|Roundup|Picks|Rankings)\\b)`, ''),
    '$1 ')

  // E. A bare year immediately before a subtitle colon, ONLY on a title that
  //    opens with "Best". That prefix is the tell: it is our own roundup
  //    phrasing, never a product name, so the year cannot be a model year.
  s = s.replace(new RegExp(`^(Best\\b[^:]*?)\\s+(?:${years})(?=\\s*:)`, ''), '$1')

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
