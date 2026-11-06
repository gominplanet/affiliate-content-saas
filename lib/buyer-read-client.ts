// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCRIPT AGENT'S FIRST STEP, IN THE CREATOR'S CHROME: which product a
// link points at, and for an Amazon product, its reviews read by SCOUT in
// the creator's own browser (SCOUT 1.58.0). Shared by Video Scripts and
// TRYBE's scripts, so both read the buyers the same way. TikTok Shop's
// reviews are read by MVP's server (lib/buyer-sources); nothing here
// fetches Amazon from MVP's server.

import { getScoutStatus, requestAmazonProduct, type AmazonReviews } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_AMAZON_REVIEWS_MIN_VERSION } from '@/lib/scout-version'
import { linkKind, type LinkKind } from '@/lib/product-scripts'

export type ReviewsWhy = 'no-scout' | 'old-scout' | 'scout-failed' | 'none-shown'

export interface BuyerInput {
  kind: LinkKind
  url: string | null
  asin: string | null
  /** The Amazon listing as SCOUT read it, when it did. */
  amazon: { title: string; bullets: string[]; description: string; price: string | null; rating: string | null } | null
  reviews: AmazonReviews | null
  /** Why SCOUT brought no reviews for an Amazon product. */
  reviewsWhy: ReviewsWhy | null
}

/** Which product the text is, and for Amazon, what SCOUT read of it and its
 *  reviews. `resolve` follows a short link on MVP's server; `step` says what
 *  is happening. Never throws: a failed read is said in reviewsWhy. */
export async function readBuyersInChrome(text: string, resolve: (url: string) => Promise<{ kind: LinkKind; url: string | null; asin: string | null }>, step: (t: string) => void): Promise<BuyerInput> {
  const t = String(text || '').trim()
  let { kind, url, asin } = linkKind(t)
  const out: BuyerInput = { kind, url, asin, amazon: null, reviews: null, reviewsWhy: null }
  if (!t || kind === 'name') return out
  if (kind === 'site' || (kind === 'amazon' && !asin)) {
    step('Reading the link')
    try { const r = await resolve(t); kind = r.kind; url = r.url || t; asin = r.asin || null } catch { /* read as given */ }
    Object.assign(out, { kind, url, asin })
  }
  if (kind !== 'amazon' || !asin) return out
  const st = await getScoutStatus().catch(() => ({ installed: false, version: null as string | null }))
  if (!st.installed) { out.reviewsWhy = 'no-scout'; return out }
  const withReviews = scoutAtLeast(st.version, SCOUT_AMAZON_REVIEWS_MIN_VERSION)
  if (!withReviews) out.reviewsWhy = 'old-scout'
  step(withReviews ? 'SCOUT is reading the Amazon page and its reviews in a background tab. About half a minute.' : 'SCOUT is reading the Amazon page in a background tab')
  const r = await requestAmazonProduct(asin, { reviews: withReviews })
  if (r.ok && r.product) out.amazon = { title: r.product.title, bullets: r.product.bullets, description: r.product.description, price: r.product.price, rating: r.product.rating }
  if (withReviews) {
    if (!r.reviews) out.reviewsWhy = 'scout-failed'
    else {
      out.reviews = r.reviews
      if (!r.reviews.onPage.length && !r.reviews.critical.length && !r.reviews.customersSay) out.reviewsWhy = 'none-shown'
    }
  }
  return out
}

/** A screenshot made small enough to send (longest side 1600px, JPEG). */
export async function shrinkPicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file is not a picture MVP can open.')); i.src = url })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } finally { URL.revokeObjectURL(url) }
}
