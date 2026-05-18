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

export function scrubBanned(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.replace(BANNED, '')
  // Tidy artifacts left by the removal.
  s = s
    .replace(/\s{2,}/g, ' ')                 // collapsed double spaces
    .replace(/\s+([,.!?;:])/g, '$1')         // space before punctuation
    .replace(/\b(a|an|our|my|the|this|their)\s+([,.!?])/gi, '$2') // dangling article
    .replace(/\(\s*\)/g, '')                  // empty parens
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s
}
