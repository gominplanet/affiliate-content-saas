// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// READ A TIKTOK SHOP PRODUCT OFF ITS OWN PAGE.
//
// The showcase is a dead end. It is an in-app mini program (the share link
// 302s to snssdk1180://ec/showcase with a seller-showcase-page.js bundle), so
// there is no showcase page for a server OR a browser extension to read, and
// TikTok's public web profile does not even carry a commerce flag: an account
// with fifty live products reports commerceUser:false and the word "showcase"
// appears zero times in 370KB of HTML.
//
// An individual PRODUCT is the opposite. shop.tiktok.com/<region>/pdp/<id> is a
// normal server-rendered page that answers 200 from a datacenter IP with no
// login, no extension and no captcha, and it carries more about the product
// than Amazon gives us without Keepa. So the catalogue is built one product at
// a time, from the link the creator already has, rather than scanned.
//
// THREE TRAPS, ALL MEASURED ON A REAL PAGE. Each one produces a plausible
// number, which is what makes them dangerous:
//
//   shop_rating          is the SELLER's rating. On the page this was written
//                        against it reads 4.7 and so does the product's, so a
//                        parser that grabs it looks correct until the day a
//                        good seller lists a bad product. The product's rating
//                        is review_ratings.overall_score.
//
//   shop_info.sold_count is the SELLER's lifetime total (6688 here). The
//                        product sold 2883. Both are integers, both look like
//                        an answer, and 6688 appears in the document first.
//
//   review_count         appears twice, 277 for the product and 624 for the
//                        shop, and the recommendations carousel adds more
//                        products with their own counts further down.
//
// So nothing here reads "the first match in the document". Every product-level
// field is taken from the ONE object that carries the matching product_id.
//
// No price history, no deal detection: there is one price on the page and no
// past for it, which is why a TikTok product must never reach the Amazon price
// claim or Deal check paths.

/** Hosts a TikTok Shop product page is served from. */
const SHOP_HOSTS = ['shop.tiktok.com', 'shop-tiktok.com']

export interface TikTokProduct {
  /** TikTok's own product id, from the URL and confirmed in the page. */
  productId: string
  title: string
  /** TikTok's marketing description. May be empty. */
  description: string
  /** Product image, upgraded to a usable size. */
  imageUrl: string | null
  /** Price as a decimal string, e.g. "279.99". Null when the page has none. */
  price: string | null
  currency: string | null
  currencySymbol: string | null
  /** THE PRODUCT's rating, never the seller's. */
  rating: number | null
  /** THE PRODUCT's review count, never the seller's. */
  reviewCount: number | null
  /** THE PRODUCT's units sold, never the seller's lifetime total. */
  soldCount: number | null
  sellerName: string | null
  /** The region segment in the URL, e.g. 'us'. */
  region: string | null
}

/** Pull the product id out of a TikTok Shop product URL. Null when it is not
 *  one, which includes a showcase link, a profile and any non-TikTok host. */
export function tiktokProductIdFromUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  let u: URL
  try { u = new URL(withScheme) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (!SHOP_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return null
  // /<region>/pdp/<id>, and the bare /pdp/<id> spelling.
  const m = u.pathname.match(/\/(?:([a-z]{2})\/)?pdp\/(\d{10,25})/i)
  return m ? m[2] : null
}

/** The region segment of a product URL ('us'), or null when it has none. */
export function tiktokRegionFromUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    const m = u.pathname.match(/\/([a-z]{2})\/pdp\//i)
    return m ? m[1].toLowerCase() : null
  } catch { return null }
}

export function isTikTokProductUrl(raw: string | null | undefined): boolean {
  return tiktokProductIdFromUrl(raw) !== null
}

/**
 * TikTok's image CDN puts the size in the path as a transform:
 * `~tplv-<token>-resize-webp:260:260.webp`. og:image ships the 260px thumbnail,
 * which is too small for a thumbnail reference or a blog hero. Rewriting the
 * two numbers returns a genuinely larger image (verified: 1200x1200, 59KB),
 * so this is a real upgrade rather than an upscale.
 *
 * Only the numbers are touched. Dropping the transform entirely returns a 400,
 * and the token is per-image, so it is never reconstructed here.
 */
export function upgradeTikTokImage(url: string | null | undefined, size = 1200): string | null {
  const s = String(url ?? '').trim()
  if (!s) return null
  const n = Math.max(100, Math.min(2000, Math.round(size)))
  // Leave anything without the transform exactly as it is: a URL we do not
  // recognise is more likely to break than to improve.
  if (!/resize-webp:\d+:\d+/.test(s)) return s
  return s.replace(/resize-webp:\d+:\d+/, `resize-webp:${n}:${n}`)
}

/** Decode the escaping TikTok uses inside its embedded JSON and HTML. */
function decode(v: string): string {
  return v
    .replace(/\\u002F/gi, '/')
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<!--\s*-->/g, '')
    .trim()
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`, 'i')
  const m = html.match(re)
  return m ? decode(m[1]) : null
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * THE PRODUCT-SCOPED READ.
 *
 * Finds the object that carries this exact product_id and reads `key` from
 * within a bounded window after it. The window matters: a page carries a
 * recommendations carousel whose products have every one of these fields, so
 * an unscoped search returns a real number belonging to a different product.
 */
function productScoped(html: string, productId: string, key: string): string | null {
  const anchor = `"product_id":"${productId}"`
  let from = 0
  for (;;) {
    const at = html.indexOf(anchor, from)
    if (at === -1) return null
    const window = html.slice(at, at + 4000)
    const m = window.match(new RegExp(`"${key}":\\s*"?([^",}]+)`))
    if (m) return decode(m[1])
    from = at + anchor.length
  }
}

/**
 * Parse a fetched TikTok Shop product page.
 *
 * `url` is required, not optional: the product id comes from the URL and is
 * then used to scope every product-level read. Without it there is no way to
 * tell this product's numbers from the carousel's.
 *
 * Returns null when the page carries no recognisable product, which is the
 * signal for the caller to say so rather than save a record of nulls.
 */
export function parseTikTokProduct(html: string, url: string): TikTokProduct | null {
  const productId = tiktokProductIdFromUrl(url)
  if (!productId || !html) return null

  const title = meta(html, 'og:title') || productScoped(html, productId, 'product_name') || ''
  if (!title) return null

  // Prices: sale_price_decimal is what the buyer pays today. Scoped, because
  // every carousel product has one.
  const price = productScoped(html, productId, 'sale_price_decimal')
    || productScoped(html, productId, 'sale_price_format')

  // The rating block. review_ratings is the PRODUCT's; shop_rating is the
  // seller's and is deliberately not read here (see the header).
  let rating: number | null = null
  let reviewCount: number | null = null
  {
    const at = html.indexOf('"review_ratings"')
    if (at !== -1) {
      const w = html.slice(at, at + 400)
      rating = num(w.match(/"overall_score":\s*"?([\d.]+)/)?.[1])
      reviewCount = num(w.match(/"review_count":\s*"?(\d+)/)?.[1])
    }
  }

  const raw = meta(html, 'og:image')
  return {
    productId,
    title,
    description: meta(html, 'og:description') || '',
    imageUrl: upgradeTikTokImage(raw),
    price: price && /^[\d.,]+$/.test(price) ? price : null,
    currency: productScoped(html, productId, 'currency_name'),
    currencySymbol: productScoped(html, productId, 'currency_symbol'),
    rating,
    reviewCount,
    soldCount: num(productScoped(html, productId, 'sold_count')),
    sellerName: decode(html.match(/Sold by ([^<]{2,80})</)?.[1] || '') || null,
    region: tiktokRegionFromUrl(url),
  }
}

/**
 * What a creator is told when a link cannot be read. Named separately from the
 * parse so the reason is a real answer rather than "something went wrong".
 */
export const TIKTOK_PRODUCT_HINT =
  'That is not a TikTok Shop product link. Open the product in TikTok Shop, tap Share, and paste the link. It looks like https://shop.tiktok.com/us/pdp/…'
