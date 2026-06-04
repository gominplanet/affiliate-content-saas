// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
/**
 * Hard guarantee for the user's banned-word rule. LLM instructions alone
 * aren't reliable, so any AI-generated copy that reaches a user surface
 * (social descriptions, image-prompt field values, etc.) is scrubbed
 * through here as a last line of defense.
 *
 * "honest" / "honestly" is banned EVERYWHERE — flagged repeatedly. We
 * remove the word and tidy the surrounding grammar so the sentence still
 * reads cleanly ("our honest review" → "our review").
 */

const BANNED = /\b(honest(?:ly)?)\b/gi

/**
 * Em-dash + en-dash + double-hyphen ban (the user's other hard rule).
 * Every AI generator drifts back to using them; this is the last line of
 * defense before any string reaches a user surface. Replacement is a
 * comma — the safest substitution in 95% of contexts.
 *
 * We DON'T strip hyphens inside compound words ("self-care", "co-pilot")
 * because those are hyphen-minus (U+002D), distinct from em/en-dash
 * (U+2014 / U+2013).
 */
const EM_DASH = /\s*[—–]\s*/g                       // — and –
const ENTITY_MDASH = /&(?:mdash|ndash);|&#8211;|&#8212;|&#x201[34];/gi
const ASCII_EMDASH = /(\S)\s*--\s*(\S)/g                       // "X -- Y" / "X--Y"

/**
 * Drop-in instruction for any AI prompt. Keep the banned list here so
 * every generator enforces the same rule (prompt-side) while scrubBanned
 * enforces it again on the output (last line of defense).
 */
export const BANNED_RULE =
  'HARD RULES: (1) never use the word "honest" or "honestly" anywhere. Write "review" not "honest review". (2) NEVER use an em-dash (—) or en-dash (–) anywhere, ever. Body, headings, image alts. Use a comma, period, or parentheses instead. Both rules are non-negotiable.'

export function scrubBanned(input: string | null | undefined): string {
  if (!input) return ''
  let s = input
    .replace(BANNED, '')
    .replace(ENTITY_MDASH, ', ')
    .replace(EM_DASH, ', ')
    .replace(ASCII_EMDASH, '$1, $2')
  // Tidy artifacts left by the removals.
  s = s
    .replace(/,\s*,/g, ',')                  // double-comma the dash sub may produce
    .replace(/\s{2,}/g, ' ')                 // collapsed double spaces
    .replace(/\s+([,.!?;:])/g, '$1')         // space before punctuation
    .replace(/\b(a|an|our|my|the|this|their)\s+([,.!?])/gi, '$2') // dangling article
    .replace(/\(\s*\)/g, '')                  // empty parens
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s
}
