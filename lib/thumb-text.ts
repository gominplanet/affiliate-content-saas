// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR OWN THUMBNAIL TEXT (Seb, 2026-10-18: "if they have something specific
// they should be able to let MVP know. This should be an option anywhere MVP
// creates thumbnails").
//
// One set of rules for every surface that takes it (Co-Pilot, Video Launchpad,
// Amazon thumbnails, the social designs, and each video in Bulk Amazon upload
// and Drop), so a text accepted on one page is never refused on another.
//
// THE CREATOR'S WORDS ARE USED AS TYPED. The art director used to be asked to
// "use these exact words" and then its two lines went through the same clamps
// and scrubs as its own copy: a line over 18 characters lost its last word, and
// a pair that read as a health claim was swapped for "WHAT YOU ACTUALLY GET".
// Either way the thumbnail said something the creator did not write, and the
// screen said nothing about it. So the split into two lines is done here, by
// rule, and a text that cannot be used as written is refused up front, with the
// reason, instead of being quietly changed.
//
// Pure and client-safe: the pages check as the creator types, and the route
// checks again before it spends anything.

import { hasHealthClaim } from '@/lib/scrub'

export const THUMB_TEXT_MAX_WORDS = 6
export const THUMB_TEXT_MAX_CHARS = 40
/** The two lines the renderer is given: a short top line and a bigger main one. */
const LINE1_MAX = 18
const LINE2_MAX = 26

/** The text as it goes on the image: one space between words, capitals. */
export function normalizeThumbText(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/[*"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Split into the top line and the main line without breaking a word. The
 *  main line is the bigger one, so it takes the longer half; one word is the
 *  main line alone. Null when the words cannot fit two lines. Pure. */
export function splitThumbText(raw: string | null | undefined): { line1: string; line2: string } | null {
  const words = normalizeThumbText(raw).split(' ').filter(Boolean)
  if (!words.length) return null
  if (words.length === 1) return words[0].length <= LINE2_MAX ? { line1: '', line2: words[0] } : null
  let best: { line1: string; line2: string; score: number } | null = null
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(' ')
    const line2 = words.slice(i).join(' ')
    if (line1.length > LINE1_MAX || line2.length > LINE2_MAX) continue
    // Balanced, with the top line no longer than the main one.
    const score = Math.abs(line2.length - line1.length) + (line1.length > line2.length ? 6 : 0)
    if (!best || score < best.score) best = { line1, line2, score }
  }
  return best ? { line1: best.line1, line2: best.line2 } : null
}

/** Why this text cannot go on a thumbnail as written, in words the creator can
 *  act on, or null when it can. Empty text is fine: MVP writes its own. Pure. */
export function thumbTextProblem(raw: string | null | undefined): string | null {
  const t = normalizeThumbText(raw)
  if (!t) return null
  const words = t.split(' ')
  if (words.length > THUMB_TEXT_MAX_WORDS) {
    return `Keep it to ${THUMB_TEXT_MAX_WORDS} words or fewer. Thumbnails read best with a few big words.`
  }
  if (t.length > THUMB_TEXT_MAX_CHARS) {
    return `Keep it under ${THUMB_TEXT_MAX_CHARS} letters so it stays big enough to read on a phone.`
  }
  // Mirrors lib/image-guard DESIGN_BRAND_WORDS: never baked into an image.
  if (/\b(amazon|amzn|prime)\b/i.test(t)) {
    return 'Amazon’s brand rules keep the words Amazon and Prime off thumbnails, so MVP cannot put them on yours. Try it without them.'
  }
  // Mirrors lib/scrub BANNED: the one word MVP never writes anywhere.
  if (/\bhonest(ly)?\b/i.test(t)) {
    return 'MVP never puts the word “honest” on a thumbnail. Try another word.'
  }
  if (hasHealthClaim(t)) {
    return 'That reads as a health claim (what a product does for a body), which MVP never puts on a thumbnail. Ask about the product instead, like “DOES IT ACTUALLY WORK?”'
  }
  if (!splitThumbText(t)) {
    return 'One of those words is too long to fit on the thumbnail. Try shorter words.'
  }
  return null
}

/** The art director's briefs with the creator's own text in place of its
 *  headline: every brief, same words, split by rule. The accent word is kept
 *  only when it is one of the creator's words. Briefs untouched when there is
 *  no own text. Pure. */
export function withOwnThumbText<T extends { line1: string; line2: string; emphasisWord?: string }>(
  briefs: T[], raw: string | null | undefined,
): T[] {
  const split = splitThumbText(raw)
  if (!split) return briefs
  const words = new Set(`${split.line1} ${split.line2}`.split(' ').filter(Boolean))
  return briefs.map((b) => ({
    ...b,
    line1: split.line1,
    line2: split.line2,
    ...(b.emphasisWord !== undefined
      ? { emphasisWord: b.emphasisWord && words.has(String(b.emphasisWord).toUpperCase()) ? String(b.emphasisWord).toUpperCase() : '' }
      : {}),
  }))
}
