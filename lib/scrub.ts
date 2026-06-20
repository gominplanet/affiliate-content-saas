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
// All three keep newlines intact: the spacing classes are [^\S\r\n] (horizontal
// whitespace only), never \s, so multi-line copy survives — YouTube descriptions
// with "----------" divider rows, multi-paragraph social captions, etc.
const EM_DASH = /[^\S\r\n]*[—–][^\S\r\n]*/g          // — and –
const ENTITY_MDASH = /&(?:mdash|ndash);|&#8211;|&#8212;|&#x201[34];/gi
// "word -- word" pseudo-em-dash ONLY. Both sides must be non-space AND non-hyphen,
// so a standalone "----------" divider row (hyphens bounded by newlines) is left
// untouched instead of being shredded into ", --, --,".
const ASCII_EMDASH = /([^\s-])[^\S\r\n]*-{2,}[^\S\r\n]*([^\s-])/g

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
  // Tidy artifacts left by the removals. All spacing classes are horizontal-only
  // ([^\S\r\n]) so line breaks and blank-line dividers are preserved.
  s = s
    .replace(/,[^\S\r\n]*,/g, ',')           // double-comma the dash sub may produce
    .replace(/[^\S\r\n]{2,}/g, ' ')          // collapse runs of spaces/tabs, keep newlines
    .replace(/[^\S\r\n]+([,.!?;:])/g, '$1')  // space before punctuation
    .replace(/\b(a|an|our|my|the|this|their)[^\S\r\n]+([,.!?])/gi, '$2') // dangling article
    .replace(/\([^\S\r\n]*\)/g, '')          // empty parens
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim()
  return s
}
