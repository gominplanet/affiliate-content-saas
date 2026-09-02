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

/** A PostgREST-safe token for a broad `.ilike` pre-filter (alphanumerics + spaces).
 *  It only narrows the DB scan; brandMatches() does the precise word-boundary check
 *  on the returned rows. Empty string means "no safe token" (caller should skip). */
export function brandLikeToken(label: string): string {
  return (label || '').replace(/[^a-z0-9 ]/gi, ' ').trim()
}
