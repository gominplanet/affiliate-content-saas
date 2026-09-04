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
 * NO HEALTH OR MEDICAL CLAIMS. Hard rule (Seb, non-negotiable).
 *
 * Nothing MVP generates may claim, imply, or ASK whether a product treats,
 * cures, prevents, heals or relieves any condition or symptom. The question
 * form is not a loophole: "Do these stop cold sores fast?" makes the same claim
 * as the statement and is the exact case this was written for. It reaches an
 * audience the same way, and a regulator reads it the same way.
 *
 * This matters most on thumbnails and titles, where copy is deliberately blunt
 * and lands with no surrounding context to soften it, but the rule is the same
 * everywhere: thumbnails, titles, descriptions, blog copy, pins, social, ad
 * copy, email.
 *
 * Detection is a claim word plus a health subject. Either alone is fine: a
 * product can "stop wobbling", and a video can be "about eczema". Together they
 * become a claim, so both must be present.
 */
const CLAIM_VERBS =
  /\b(?:cure[sd]?|heal(?:s|ed|ing)?|treat(?:s|ed|ing|ment)?|remed(?:y|ies)|stop(?:s|ped|ping)?|prevent(?:s|ed|ing)?|reverse[sd]?|eliminat(?:e|es|ed|ing)|get\s+rid\s+of|clear(?:s|ed)?\s+up|fix(?:es|ed)?|banish(?:es|ed)?|fight(?:s|ing)?|kill(?:s|ed|ing)?|relieve[sd]?|relief|sooth(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|shrink(?:s)?|dissolve[sd]?|boost(?:s|ed|ing)?|detox(?:es|ify|ifies)?|regrow(?:s|th)?|restore[sd]?|repair(?:s|ed)?)\b/i

const HEALTH_SUBJECTS =
  /\b(?:cold\s+sores?|herpes|acne|pimples?|blackheads?|eczema|psoriasis|rosacea|dermatitis|warts?|fungus|fungal|toenail\s+fungus|dandruff|hair\s*loss|balding|alopecia|wrinkles?|cellulite|stretch\s+marks?|scars?|pain|aches?|migraines?|headaches?|arthritis|inflammation|swelling|anxiety|depression|stress|insomnia|sleep\s+apnea|snoring|adhd|autism|diabetes|blood\s+sugar|blood\s+pressure|cholesterol|cancer|tumou?rs?|covid|flu|colds?|allergies|asthma|ibs|bloating|constipation|diarrh(?:o)?ea|acid\s+reflux|heartburn|ulcers?|uti|yeast\s+infections?|menopause|cramps?|hangovers?|nausea|vertigo|tinnitus|dry\s+eyes?|varicose\s+veins?|hemorrhoids?|haemorrhoids?|immune\s+system|immunity|metabolism|libido|erectile|fertility|weight\s+loss|belly\s+fat|toxins?)\b/i

/** True when a piece of copy makes, implies or asks a health claim. */
export function hasHealthClaim(input: string | null | undefined): boolean {
  if (!input) return false
  const s = String(input)
  return CLAIM_VERBS.test(s) && HEALTH_SUBJECTS.test(s)
}

/**
 * Remove the offending sentence rather than trying to rewrite it.
 *
 * A claim cannot be edited into safety by deleting one word: strike "stop" from
 * "do these stop cold sores fast?" and you get something that is still about
 * treating cold sores and now reads as gibberish. Dropping the whole sentence is
 * blunt, and blunt is right for a compliance rule. Callers that end up with
 * nothing left fall back to their own default copy.
 *
 * Splits on sentence ends AND newlines, so a claim in one bullet or one headline
 * line does not take the rest of the copy with it.
 */
export function scrubHealthClaims(input: string | null | undefined): string {
  if (!input) return ''
  const parts = String(input).split(/(?<=[.!?])\s+|\n/)
  const kept = parts.filter((p) => !hasHealthClaim(p))
  if (!kept.length) return ''
  // Rejoin the way it came in: newlines stay newlines, sentences stay sentences.
  return String(input).includes('\n')
    ? kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : kept.join(' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Drop-in instruction for any AI prompt. Keep the banned list here so
 * every generator enforces the same rule (prompt-side) while scrubBanned
 * enforces it again on the output (last line of defense).
 */
export const BANNED_RULE =
  'HARD RULES: (1) never use the word "honest" or "honestly" anywhere. Write "review" not "honest review". (2) NEVER use an em-dash (—) or en-dash (–) anywhere, ever. Body, headings, image alts. Use a comma, period, or parentheses instead. (3) NEVER make a health or medical claim, in any form, anywhere. Do not say or imply that a product treats, cures, prevents, heals, relieves, reduces or gets rid of any condition or symptom. A QUESTION is not an exception: "Do these stop cold sores fast?" is a medical claim and is forbidden exactly like the statement. Describe what the product IS and what it is designed for, never what it will do to a body or a condition. All three rules are non-negotiable.'

export function scrubBanned(input: string | null | undefined): string {
  if (!input) return ''

  // GUARD HTML comments FIRST. Gutenberg block delimiters are HTML comments —
  // `<!-- wp:group {…} -->` — and their `--` / `-->` sequences ARE the ASCII
  // double-hyphen idiom ASCII_EMDASH rewrites to a comma. Without this guard the
  // scrub turns every `<!-- wp:group -->` into `<!, wp:group, >`, dumping raw
  // block markup as visible text all over the published post (reported on a
  // Levanta post 2026-07-07). The campaign-writer routes (Levanta + Walmart/PB)
  // scrub the FULL block HTML through here, unlike blog/generate which uses the
  // already-guarded lib/html-scrub. Pull each comment out to an inert token, run
  // the scrubs, then restore verbatim. Plain-text callers (titles, social copy)
  // have no comments, so this is a no-op for them.
  //
  // Token shape `[[MVPCMT:N:]]` is deliberate: no whitespace, commas, dashes, or
  // "<space><punct>" runs, so NONE of the tidy passes below can touch it (checked
  // pass-by-pass), and it restores cleanly. Same token lib/html-scrub uses.
  const comments: string[] = []
  let s = input.replace(/<!--[\s\S]*?-->/g, (m) => {
    comments.push(m)
    return `[[MVPCMT:${comments.length - 1}:]]`
  })

  // Health claims come out FIRST, before any tidying, because the check reads
  // whole sentences and the tidy passes reshape them. A prompt rule alone has
  // never been enough for the other two bans and it is not enough for this one.
  s = scrubHealthClaims(s)

  s = s
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

  // Restore the untouched block comments verbatim.
  return s.replace(/\[\[MVPCMT:(\d+):\]\]/g, (_m, i) => comments[Number(i)] ?? '')
}
