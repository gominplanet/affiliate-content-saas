// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEVERAL PRODUCTS IN ONE BOX (Seb, 2026-10-12: "if there is two or more
// items MVP should create thumbnails that compare the items .. so if user
// pastes 3 asins, the image should reflect those three products").
//
// Every "Amazon product link or ASIN" box in MVP read one product, and a list
// pasted into it was sent as one broken link and silently came back as no
// product at all. This reads a pasted list (commas, spaces, new lines) into
// the products in it, in order, deduped, at most MAX_COMPARE. Both ASINs and
// links are kept: the server follows a link to its product. Imports only
// lib/asin (which imports nothing), so the browser can use it. Tested in scripts/test-product-list.

import { asinFromAmazonUrl } from '@/lib/asin'

export const MAX_COMPARE = 4

/** The products pasted into one box: ASINs upper-cased, links as given. */
export function readProductList(raw: string | null | undefined): string[] {
  const s = String(raw || '').trim()
  if (!s) return []
  const out: string[] = []
  const seen = new Set<string>()
  // Links first, in place, so a comma inside a link never splits it.
  const tokens = s.split(/[\s,;|]+/).map((t) => t.trim()).filter(Boolean)
  for (const t of tokens) {
    let item: string | null = null
    if (/^https?:\/\//i.test(t)) item = t.replace(/[.,;:)\]>"']+$/, '')
    else if (/^[A-Z0-9]{10}$/i.test(t) && /\d/.test(t)) item = t.toUpperCase()
    if (!item) continue
    // An Amazon link and its own ASIN pasted together are one product.
    const asin = /^https?:/i.test(item) ? asinFromAmazonUrl(item)?.toUpperCase() : undefined
    const key = asin || (/^[A-Z0-9]{10}$/.test(item) ? item : item.toLowerCase())
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= MAX_COMPARE) break
  }
  return out
}

/** The request fields for one box: one product as before; two or more as a
 *  comparison, with the first one as the main product. */
export function productFields(raw: string): Record<string, unknown> {
  const list = readProductList(raw)
  const first = list[0] ?? raw.trim()
  const one = /^https?:\/\//i.test(first) ? { productUrl: first } : /^[A-Z0-9]{10}$/i.test(first) ? { asin: first.toUpperCase() } : { productUrl: first }
  return list.length >= 2 ? { ...one, comparisonAsins: list } : one
}

/** What the screen says when fewer products made it into the image than were
 *  pasted. null when all of them did, or when it was one product. */
export function comparisonNote(c: { asked?: number; shown?: number } | null | undefined): string | null {
  if (!c || !c.asked || c.asked < 2) return null
  const shown = c.shown ?? 0
  if (shown >= c.asked) return null
  if (shown < 2) return `MVP could not find photos for enough of your ${c.asked} products, so this image shows one product. Check the ASINs or links, or upload the product photos.`
  return `${shown} of your ${c.asked} products are in this image: MVP could not find a photo for the others. Check their ASINs or links.`
}

/** The first product in the box, for what takes only one (a caption, the
 *  link a post carries). The raw text when nothing in it reads as a product. */
export function firstProduct(raw: string): string {
  return readProductList(raw)[0] ?? raw.trim()
}

/** The line under a product box. */
export function productBoxHint(raw: string, oneLinkNote = false): string {
  const n = readProductList(raw).length
  if (n >= 2) return `${n} products: the image compares them side by side.${oneLinkNote ? ' The caption and the link use the first one.' : ''}`
  return 'Comparing products? Paste 2 to 4 ASINs or links, separated by commas or spaces, and the image shows all of them.'
}
