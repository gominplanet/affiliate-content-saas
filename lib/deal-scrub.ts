// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Deal-spotter scrub.
//
// Deal posts are NOT reviews — the user hasn't tested the product, there's no
// video, no hands-on time. The voice must stay as "I'm tracking this drop /
// I flagged this price" and never claim hands-on experience. This scrub is
// the safety net after the prompt rule, because Sonnet will occasionally slip
// in a reviewer-voice phrase by reflex.
//
// IMPORTANT: this is DEAL-SPECIFIC. We do NOT extend lib/scrub.ts's global
// BANNED list with these phrases, because regular reviews/comparisons SHOULD
// use first-hand language ("I tested for two weeks"). The global scrub stays
// review-friendly; this one runs ONLY on deal-hub output.
//
// All replacements collapse cleanly: dangling articles trimmed, double spaces
// dropped, sentence terminators preserved.

import { scrubBanned } from './scrub'
import { scrubAiHtml } from './html-scrub'

/** Phrases that imply the writer used/tested/owned the product. These all
 *  get rewritten to deal-spotter equivalents that stay first-person but
 *  honest about not having hands-on time. Ordered: more-specific first so
 *  shorter matches don't pre-empt longer ones. */
const REWRITES: Array<[RegExp, string]> = [
  // "I tested this for X weeks" → "I've been watching this"
  // Removes hands-on claims while keeping the I-voice. No "the listing"
  // language — the user calibration rule is that deal posts should just
  // talk about the product directly, not cite where the data came from.
  [/\bI(?:'ve| have)?\s+tested\s+(this|it|the\s+\w+)\b/gi, "I've been watching $1"],
  [/\bI(?:'ve| have)?\s+been\s+testing\s+(this|it|the\s+\w+)\b/gi, "I've been tracking $1"],
  [/\bafter\s+(?:a\s+(?:few\s+)?(?:days?|weeks?|months?)|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:days?|weeks?|months?))\s+(?:with|of|using)\b/gi, 'with'],
  [/\bin\s+my\s+experience\s+with\s+(this|it|the\s+\w+)\b/gi, 'with $1'],

  // "I've used X" / "I use X daily" → "I've been tracking X"
  [/\bI(?:'ve| have)?\s+used\s+(this|it|the\s+\w+)\b/gi, "I've been tracking $1"],
  [/\bI\s+use\s+(this|it|the\s+\w+)\s+(?:daily|every\s+day|all\s+the\s+time|constantly)\b/gi, "I've been tracking $1"],

  // "I tried X" → "I checked X"
  [/\bI(?:'ve| have)?\s+tried\s+(this|it|the\s+\w+)\b/gi, "I looked at $1"],

  // "I own X" / "I bought X" / "I picked one up" → "I flagged this"
  [/\bI\s+own\s+(this|it|the\s+\w+)\b/gi, "I've been tracking $1"],
  [/\bI(?:'ve| have)?\s+bought\s+(this|it|the\s+\w+)\b/gi, "I've been tracking $1"],
  [/\bI\s+picked\s+(?:one|this|it)\s+up\b/gi, "I flagged this drop"],

  // "my X" possessive about the product → "this X"
  // (only the obvious cases — too aggressive a rewrite breaks copy)
  [/\bmy\s+(unit|copy|pair|set)\b/gi, 'this $1'],

  // "hands-on" / "hands on" claims
  [/\bhands[- ]on\s+(?:time|experience|impressions?|review|test)\b/gi, 'spec review'],
  [/\bafter\s+(?:hands[- ]on|firsthand)\s+(?:time|use|testing)\b/gi, 'after reviewing the listing'],

  // "real-world" wording often implies usage
  [/\breal[- ]world\s+(?:test(?:ing)?|use|experience)\b/gi, 'real-world value'],

  // "I tested this" → "I tracked this" (catch-all for any tested+pronoun that
  // slipped past more-specific patterns above)
  [/\b(I|we)(?:'ve| have)?\s+tested\b/gi, "$1've been tracking"],
  [/\b(I|we)\s+tested\b/gi, "$1 tracked"],
]

/** Rewrite reviewer-voice phrases to deal-spotter equivalents. Runs before
 *  scrubBanned so the "honest/honestly" sweep still catches anything left. */
export function scrubReviewLanguage(html: string): string {
  if (!html) return html
  let out = html
  for (const [pattern, replacement] of REWRITES) {
    out = out.replace(pattern, replacement)
  }
  // Tidy: collapse double spaces, fix "a I'm" / "the I've" oddities (rare,
  // but happens when an earlier word got eaten).
  out = out.replace(/\s{2,}/g, ' ')
  return out
}

/** "The listing X" phrases get yanked outright. Per the user's
 *  calibration: deal articles should READ as if the writer knows the
 *  product directly — never cite "the listing" as a source. The writer
 *  prompt forbids them, this catches anything Sonnet still slips through. */
const LISTING_CLEANUPS: Array<[RegExp, string]> = [
  // Lead-in clauses: drop the whole phrase + comma so the next clause
  // reads as the article's confident voice.
  [/^Based on the listing,?\s*/gim, ''],
  [/\bBased on the listing,?\s+/gi, ''],
  [/\bLooking at the listing,?\s*/gi, ''],
  [/\bAccording to the listing,?\s*/gi, ''],
  [/\bPer the listing,?\s*/gi, ''],
  [/\bFrom the listing,?\s*/gi, ''],

  // Mid-sentence "the listing X" reframes: rewrite to direct product talk.
  [/\bthe listing (?:claims|states|says|describes|notes|mentions|shows|surfaces|highlights|describes|points\s+out|is\s+clear(?:ly)?(?:\s+aimed)?(?:\s+at)?)\b/gi, 'this'],
  [/\bthe listing'?s focus\b/gi, 'the product’s focus'],
  [/\bthe spec sheet (?:says|shows|notes|claims|describes)\b/gi, 'the specs say'],
  [/\baccording to the spec sheet,?\s*/gi, ''],
  [/\bbased on the spec sheet,?\s*/gi, ''],

  // Direct article-reference references to "Amazon's listing" / "the
  // Amazon page" / "the product page" — same problem, slightly different
  // wording.
  [/\b(?:on|in|per|from)\s+(?:Amazon's listing|the Amazon (?:page|listing)|the product page)\s*,?\s*/gi, ''],
]

/** Drop "based on the listing" / "the listing says" phrases everywhere.
 *  Independent of scrubReviewLanguage because these are about VOICE
 *  (confident direct knowledge) not just hands-on-time wording. */
export function scrubListingReferences(html: string): string {
  if (!html) return html
  let out = html
  for (const [pattern, replacement] of LISTING_CLEANUPS) {
    out = out.replace(pattern, replacement)
  }
  // Tidy up sentence starts that lost their leading clause: re-capitalise
  // the first letter after the comma we removed. Cheap heuristic — only
  // affects sentences that started with the deleted phrase.
  out = out.replace(/(<p>|<li>|^|\.\s+)\s*([a-z])/g, (_m, lead, c) => lead + c.toUpperCase())
  return out.replace(/\s{2,}/g, ' ')
}

/** Full deal-post scrub: strip code fence + em-dashes + reviewer-voice
 *  phrases + "the listing" references + the global banned-word list.
 *  Runs in this order so each pass has the cleanest input. */
export function scrubDealHtml(raw: string): string {
  return scrubBanned(scrubListingReferences(scrubReviewLanguage(scrubAiHtml(raw))))
}

/** Hard-rule block injected into the deal-post Sonnet prompt. Keep tight —
 *  the prompt is already long and Sonnet ignores long bullet lists. */
export const DEAL_VOICE_RULES = [
  'VOICE RULE: this is NOT a review. The author has NOT tested, used, or owned this product. The author is a deal-spotter writing with confident product knowledge.',
  'OK: "I\'ve been tracking this", "I flagged this drop", confident direct product talk ("The 6500 RPM motor handles X", "It ships with two 2.0Ah batteries").',
  'NEVER claim hands-on time: no "I tested", "I used", "I tried", "I own", "I bought", "after a week with…", "in my experience", "hands-on", "real-world testing", "I picked one up".',
  'NEVER cite "the listing" as a source: no "based on the listing", "the listing says/claims/describes/shows/is clearly aimed", "looking at the listing", "per the listing", "from the spec sheet", "according to the spec sheet". Just state the spec as known fact, the way a magazine editor would.',
  'OK to commentate on value, price history, and spec-anchored fit ("at this price, this fits X kind of buyer because the motor only does Y"). Never frame it as citing a source.',
].join(' ')
