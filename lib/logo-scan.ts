// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND THE THUMBNAILS THAT ALREADY HAVE A STORE'S LOGO ON THEM.
//
// A creator generated a thumbnail, got an Amazon logo rendered into it, and
// pulled his video down. The prompt that caused it is fixed, but that fix only
// applies to pictures made from now on. Everything generated before it is still
// out there, on videos and posts that are already published, and no screen
// anywhere can say which ones.
//
// This is not cosmetic. The Associates Operating Agreement governs where an
// associate may put Amazon's marks, and a thumbnail MVP generated is a place
// MVP put one on somebody's behalf. The creator is the one carrying that.
//
// So: ask a vision model, one picture at a time, and report per picture. The
// judgement this module owns is the prompt and how the answer is read, both
// pure, because the way this goes wrong is subtle and needs pinning:
//
//   a false YES   sends a creator to redo a thumbnail that was fine, and after
//                 two of those they stop believing the tool
//   a false NO    leaves the mark up, which is the whole problem
//   a silent skip is the worst of the three. An image that could not be fetched
//                 is not a clean image, and reporting it as one is how somebody
//                 concludes their back catalogue is clear when it was never read
export type LogoVerdict = 'found' | 'clean' | 'unreadable'

export interface LogoFinding {
  verdict: LogoVerdict
  /** Which mark, when one was found. Empty otherwise. */
  marks: string[]
  /** Why, when it could not be checked. */
  reason?: string
}

/**
 * The question put to the vision model.
 *
 * Narrow on purpose. "Does this image contain a logo" catches the product's own
 * brand mark, which is meant to be there and is the single most common thing in
 * a product thumbnail. The line that matters is RETAILER versus MANUFACTURER,
 * and it has to be drawn in the prompt rather than in the reading of the answer.
 */
export const LOGO_SCAN_PROMPT = `Look at this image, which is a YouTube-style thumbnail for a product review.

Answer ONE question: does it show the logo, wordmark or brand symbol of a RETAILER or MARKETPLACE?

Retailers and marketplaces include: Amazon (including the smile or curved-arrow symbol on its own), Amazon Prime, Walmart, Target, Best Buy, eBay, Etsy, AliExpress, Temu, Costco, Wayfair, and any store badge such as "Amazon's Choice" or "Best Seller".

Do NOT count any of these:
- the logo or name of the company that MAKES the product, printed on the product itself or its packaging
- a social platform logo such as YouTube, TikTok or Instagram
- the creator's own branding
- generic shapes, arrows or swooshes that are not a recognisable retailer mark

Reply with strict JSON and nothing else:
{"found": true|false, "marks": ["Amazon"], "confidence": "high"|"low"}

Set found to true ONLY if you can actually see a retailer mark. If you are unsure, set found to false and confidence to "low".`

/**
 * Read the model's reply.
 *
 * A reply that cannot be parsed is `unreadable`, never `clean`. Treating a
 * confusing answer as a pass is the silent skip this module exists to avoid,
 * and it would be invisible: the creator sees a green row.
 */
export function readLogoReply(raw: string | null | undefined): LogoFinding {
  const text = (raw ?? '').trim()
  if (!text) return { verdict: 'unreadable', marks: [], reason: 'the check returned nothing' }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { verdict: 'unreadable', marks: [], reason: 'the check did not answer in the expected form' }
  }

  let parsed: { found?: unknown; marks?: unknown; confidence?: unknown }
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { verdict: 'unreadable', marks: [], reason: 'the check did not answer in the expected form' }
  }

  if (typeof parsed.found !== 'boolean') {
    return { verdict: 'unreadable', marks: [], reason: 'the check gave no yes or no' }
  }

  if (!parsed.found) return { verdict: 'clean', marks: [] }

  const marks = Array.isArray(parsed.marks)
    ? parsed.marks.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map(m => m.trim())
    : []

  // A "found" with low confidence and no named mark is a guess. Reported as
  // unreadable rather than as a finding, because sending somebody to redo a
  // thumbnail on a hunch costs them work and costs the tool its credibility.
  if (parsed.confidence === 'low' && marks.length === 0) {
    return { verdict: 'unreadable', marks: [], reason: 'the check was unsure and named nothing' }
  }

  return { verdict: 'found', marks: marks.length ? marks : ['a retailer mark'] }
}

export interface LogoScanSummary {
  found: number
  clean: number
  unreadable: number
  headline: string
}

/**
 * The line at the top.
 *
 * "Nothing found" and "nothing found, and I could not open nine of them" are
 * different results, and only the first one is a clean back catalogue.
 */
export function summariseLogoScan(findings: LogoFinding[]): LogoScanSummary {
  const found = findings.filter(f => f.verdict === 'found').length
  const clean = findings.filter(f => f.verdict === 'clean').length
  const unreadable = findings.filter(f => f.verdict === 'unreadable').length

  let headline: string
  if (findings.length === 0) {
    headline = 'No thumbnails to check.'
  } else if (found > 0) {
    headline = found === 1
      ? `1 thumbnail has a store's logo on it. It is listed below.`
      : `${found} thumbnails have a store's logo on them. They are listed below.`
  } else if (unreadable > 0) {
    headline = clean > 0
      ? `No store logos in the ${clean} thumbnails we could open. ${unreadable} could not be opened, so those remain unchecked.`
      : `None of the ${unreadable} thumbnails could be opened, so nothing was actually checked.`
  } else {
    headline = `Checked ${clean} ${clean === 1 ? 'thumbnail' : 'thumbnails'}. No store logos on any of them.`
  }

  return { found, clean, unreadable, headline }
}
