// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH PRODUCT IS THIS CLIP ABOUT? Clip Factory asked for the ASIN and the
// product name on every clip that did not come from a scripted video, and a
// creator (Alejandro, 2026-10-05) asked the obvious question: can't it fill
// that in? Most of the time MVP already knows:
//
//   the file name      "Ninja Crispi - B0DDDD8WD6.mp4" carries the ASIN
//   the source video   a picked Short's own row: its ASIN, its product link,
//                      the Amazon link in its description
//   the creator's work the product name MVP already wrote down for that ASIN
//                      (a video, a Liftoff item, a script, a campaign)
//
// and when none of that says, the creator's recent products are offered as
// one-tap picks. Pure parts here; the route does the reads.

import { asinInFileName, asinFromAmazonUrl, amazonProductUrlRegex } from '@/lib/asin'

/** A product name from a file name: no extension, no ASIN, no junk. Pure. */
export function nameFromFileName(file: string | null | undefined): string | null {
  const base = String(file || '').replace(/\.[a-z0-9]{2,4}$/i, '')
  const cleaned = base
    .replace(/(?<![A-Z0-9])B0[A-Z0-9]{8}(?![A-Z0-9])/gi, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(img|vid|video|clip|final|export|copy|short|reel|v\d+)\b/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // A name needs letters; "IMG 4821" is a camera roll, not a product.
  return /[a-z]{3,}/i.test(cleaned) && cleaned.length >= 4 && !/^[\d\s]+$/.test(cleaned) ? cleaned.slice(0, 80) : null
}

/** The first Amazon product ASIN in a block of text (a description). Pure. */
export function asinInText(text: string | null | undefined): string | null {
  const t = String(text || '')
  for (const m of t.match(amazonProductUrlRegex()) ?? []) {
    const a = asinFromAmazonUrl(m)
    if (a) return a
  }
  return null
}

export { asinInFileName }
