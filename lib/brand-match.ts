// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Matching a user-typed favorite brand (e.g. "Dreame") to Creator Connections
// campaigns is fuzzy: Amazon returns brand_name inconsistently — sometimes the
// clean brand, sometimes a variant ("Dreame Technology"), sometimes null with the
// brand only in the title. An exact brand_name match misses all of those, which is
// why MVP under-counted a brand's real campaign set. We match the label as a WHOLE
// WORD in either the brand or the campaign name, so "Dreame" catches
// "Dreame Technology" and a null-brand "Dreame Smart Dehumidifier" title, but not
// the different brand "Dreamegg" (no word boundary after "dreame" there).

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word, case-insensitive matcher for a favorite-brand label. Boundaries are
 *  start/end or any non-alphanumeric char, so "dreame" ≠ "dreamegg". */
export function brandRegex(label: string): RegExp {
  const esc = escapeRegex(label.trim())
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i')
}

/** True when the label appears as a whole word in any of the given fields
 *  (brand name and/or campaign title). */
export function brandMatches(label: string, ...fields: Array<string | null | undefined>): boolean {
  const l = (label || '').trim()
  if (!l) return false
  const re = brandRegex(l)
  return fields.some((f) => !!f && re.test(String(f)))
}

/** Is this campaign actually SOLD BY the favourited brand?
 *
 *  brandMatches above is deliberately loose: it accepts the label in the brand
 *  OR the title, because Amazon leaves brand_name null often enough that a
 *  title-only match is the only way to find those campaigns.
 *
 *  That looseness is wrong the moment the answer is used to DO something to the
 *  brand. "Message all" on Levoit opened a window addressed to 14 brands, 13 of
 *  which were other sellers whose product titles happen to say Levoit:
 *  replacement filters, compatible parts, comparison listings. Sending that is
 *  not a miscount on a badge, it is thirteen unwanted messages going out from
 *  the creator's own Amazon account, to brands they never chose, and there is no
 *  unsend.
 *
 *  So: when brand_name is present it is the authority, and a different brand is
 *  a different brand no matter what its title says. Only when brand_name is
 *  missing do we fall back to the title, which is the exact case the loose match
 *  was written for and the only one where it is safe.
 */
export function brandIsSeller(
  label: string,
  brandName: string | null | undefined,
  campaignName: string | null | undefined,
): boolean {
  const l = (label || '').trim()
  if (!l) return false
  const brand = String(brandName ?? '').trim()
  // A named brand answers the question by itself, in both directions.
  if (brand) return brandMatches(l, brand)
  // No brand recorded: the title is all there is.
  return brandMatches(l, campaignName)
}

/** A PostgREST-safe token for a broad `.ilike` pre-filter (alphanumerics + spaces).
 *  It only narrows the DB scan; brandMatches() does the precise word-boundary check
 *  on the returned rows. Empty string means "no safe token" (caller should skip). */
export function brandLikeToken(label: string): string {
  return (label || '').replace(/[^a-z0-9 ]/gi, ' ').trim()
}
