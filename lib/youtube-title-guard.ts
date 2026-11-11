// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// IS THIS A YOUTUBE TITLE, OR A STAND-IN FOR ONE?
//
// Jarett, 2026-11-11, on Drop: "it no longer gives me an accurate title for
// youtube; they're pretty generic e.g. THIS TEST, WORTH IT?, THIS PRODUCT
// REVIEW, THIS WIN?, BIG MISTAKE?". Seb: "we need to fix this once and for
// all. I never want to see these generic, terrible titles."
//
// Those five were the thumbnail headline writer's canned fallback (lib/title-
// options), reached when the product's name could not be found, and shown and
// saved as YouTube titles. Before them the same hole produced AMAZON TEST and
// AMAZON PRODUCT REVIEW, and before that the ASIN and the file name went to
// YouTube as titles. Each was fixed where it came from; this is the check every
// title MVP writes for YouTube passes through, whatever wrote it.
//
// `genericTitleWhy` says why a title is not one (in a few words a creator can
// read), or null for a real title. With the product known, a short title that
// does not name it is not one either. Pure.

import { titleNamesProduct } from '@/lib/title-product'

/** Lines that fit any video, so they name none. Compared without punctuation. */
const STOCK = new Set([
  'THIS TEST', 'WORTH IT', 'THIS PRODUCT REVIEW', 'THIS WIN', 'BIG MISTAKE', 'PRODUCT REVIEW', 'THIS PRODUCT',
  'AMAZON TEST', 'AMAZON WIN', 'AMAZON PRODUCT REVIEW', 'AMAZON PRODUCT', 'AMAZON FIND', 'AMAZON FINDS',
  'MUST HAVE', 'GAME CHANGER', 'I WASNT READY', 'WHOA', 'WOW', 'REVIEW', 'UNBOXING', 'TESTED', 'NEW VIDEO',
  'PRODUCT TEST', 'IS IT WORTH IT', 'DONT BUY', 'DONT BUY THIS', 'WATCH THIS', 'YOUR TITLE HERE', 'UNTITLED',
])

const plain = (s: string) => s.toUpperCase().replace(/&AMP;/g, '&').replace(/[^A-Z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** A title made of a file name: what the camera called the clip. */
export function looksLikeFileName(title: string): boolean {
  const t = String(title || '').trim()
  return /\.(mp4|mov|m4v|avi|mkv|webm|mts|3gp)$/i.test(t)
    || /^(IMG|VID|DSC|DSCF|PXL|MVI|GOPR|GH\d|DJI|MOV|CLIP|VIDEO|SCREEN[ _-]?RECORDING|RPReplay)[_ -]?\d/i.test(t)
    || /^\d{6,8}[_ -]?\d{4,6}/.test(t)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)
    || /^[\d_ .-]+$/.test(t)
}

export function genericTitleWhy(title: string | null | undefined, product?: { brand?: string | null; canonical?: string | null } | null): string | null {
  const t = String(title || '').trim()
  if (!t) return 'it has no title'
  if (/^[A-Z0-9]{10}$/i.test(t) && /\d/.test(t)) return 'it is only the product code'
  if (looksLikeFileName(t)) return 'it is the file name'
  if (/\bB0[A-Z0-9]{8}\b/i.test(t)) return 'it carries the product code instead of its name'
  const p = plain(t)
  if (STOCK.has(p)) return 'it is a stock phrase that fits any video'
  if (/\b(THIS|THE|AN?|AMAZON) (PRODUCT|ITEM|THING|GADGET)\b/.test(p) && p.split(' ').length <= 5) return 'it names no product'
  const words = t.split(/\s+/).filter(Boolean)
  // Two or three words in capitals is a thumbnail line ("CHIA WORTH IT?"):
  // right on the picture, and not a title anyone searches for.
  if (words.length <= 3 && /[A-Z]/.test(t) && t === t.toUpperCase()) return 'it is a thumbnail line, not a title'
  if (product && words.length <= 5) {
    const named = titleNamesProduct(t, product)
    if (named.checked && !named.ok) return 'it does not name the product'
  }
  return null
}

/** The titles worth offering or saving, in order, with no repeats. */
export function realTitles(titles: Array<string | null | undefined>, product?: { brand?: string | null; canonical?: string | null } | null): string[] {
  const out: string[] = []
  for (const raw of titles) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!t || genericTitleWhy(t, product)) continue
    if (out.some((o) => o.toLowerCase() === t.toLowerCase())) continue
    out.push(t)
  }
  return out
}
