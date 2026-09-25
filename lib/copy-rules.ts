// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The house rules for any line MVP writes for a creator, applied in one place.
//
//   No dashes as sentence breaks.  " - ", en dash and em dash become a comma.
//   A range stays a range.         "3–5 hours" becomes "3 to 5 hours", not "3, 5".
//   No year.                       Only THIS year and next, so a spec such as
//                                  "2000 mAh" or "1080p" is never eaten.
//   No banned words.               scrubBanned: every form of "honest", and the rest.

import { scrubBanned } from '@/lib/scrub'

export function tidyCopy(input: unknown, now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  // The range first: scrubBanned has its own dash handling and would turn it
  // into a comma before this could read it.
  return scrubBanned(String(input ?? '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    // A spaced hyphen between numbers is a range too ("20 - 30"), not a pause.
    .replace(/(\d)\s+-\s+(\d)/g, '$1 to $2')
    // Every form of the word, including the ones scrubBanned lets through.
    .replace(/\bhonest(?:y|ly)?\b/gi, ''))
    .replace(/\s+[-–—]+\s+/g, ', ')
    .replace(/[–—]/g, ', ')
    .replace(new RegExp(`\\b(${y}|${y + 1})\\b`, 'g'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,]+/, '')
    .trim()
}
