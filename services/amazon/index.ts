export interface AmazonProduct {
  asin: string
  title: string
  bullets: string[]
  description: string
  price: string | null
  rating: string | null
  imageUrl: string | null
  /** All gallery hi-res images (main first). Lets a vision picker choose the
   *  cleanest isolated product shot instead of a lifestyle/collage main image. */
  images: string[]
  /** Optional deal/discount signals — populated when Amazon's listing shows a
   *  strike-through original price, a coupon, or a limited-time deal badge.
   *  Powers the Deals Hub flow; the regular review/comparison pipelines just
   *  ignore them.
   *
   *  Notes per field:
   *  - priceWas: the strike-through "list price" / "was" price as displayed
   *    (string with currency symbol, e.g. "$199.99"). Falls back to null if
   *    Amazon isn't showing a comparison price.
   *  - priceSale: the current sale price if Amazon is exposing it as a
   *    distinct lower price (often the same as `price` above, but kept
   *    separate so callers can tell discount-present vs no-discount cases
   *    without inferring from string compare).
   *  - dealBadge: the deal label Amazon shows ("Lightning Deal", "Limited
   *    time deal", "Prime Day", "Black Friday", "Coupon", "Deal of the Day",
   *    etc.) Cased exactly as scraped; downstream prompts use this as hype
   *    fuel.
   *  - dealEndsAt: ISO 8601 string (yyyy-mm-dd or full ISO) extracted when
   *    Amazon shows an expiration ("Deal ends Jun 15", coupon countdown,
   *    "Ends in 2 days"). Best-effort, frequently null.
   *  - discountPct: integer 1-99 if Amazon shows a "% off" badge inline;
   *    independent of priceWas/priceSale because some listings show only
   *    the percentage. */
  priceWas: string | null
  priceSale: string | null
  dealBadge: string | null
  dealEndsAt: string | null
  discountPct: number | null
}

/** True if `token` looks like a real Amazon ASIN rather than an ordinary
 *  word. Canonical modern ASINs are `B0` + 8 chars; older/book ASINs are 10
 *  chars but ALWAYS contain at least one digit. Plain 10-letter English words
 *  ("UNDERWATER", "WATERPROOF", "TECHNOLOGY", "SMARTWATCH"…) contain no digit,
 *  so requiring a digit keeps the loose matcher from turning a title word into
 *  a fake ASIN (which produced dead amazon.com/dp/UNDERWATER affiliate links). */
export function isValidAsin(token: string): boolean {
  const t = token.toUpperCase()
  if (/^B0[A-Z0-9]{8}$/.test(t)) return true
  return /^[A-Z0-9]{10}$/.test(t) && /[0-9]/.test(t)
}

// Extract a real ASIN from free text (e.g. a YouTube title). Prefers the
// canonical B0… form; otherwise accepts a 10-char token ONLY if it contains a
// digit — so ordinary 10-letter words are never mistaken for an ASIN.
export function extractAsin(text: string): string | null {
  const up = text.toUpperCase()
  const b0 = up.match(/\b(B0[A-Z0-9]{8})\b/)
  if (b0) return b0[1]
  // Fallback: any 10-char alphanumeric token that contains at least one digit.
  for (const m of up.match(/\b[A-Z0-9]{10}\b/g) || []) {
    if (isValidAsin(m)) return m
  }
  return null
}

/**
 * Search Amazon by free-text query and return the first product's
 * ASIN, or null if nothing reasonable came back / Amazon blocked us.
 *
 * Used to recover an affiliate link when a video title mentions a
 * product by name but doesn't carry the 10-char ASIN code. Cheap
 * fallback — if it fails, callers should treat the video as general
 * content rather than break the whole generation.
 */
export async function searchAmazonForAsin(query: string): Promise<string | null> {
  const q = (query || '').trim()
  if (!q) return null
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    // Match the first /dp/ASIN/ link inside a search-result tile, which
    // is what Amazon's organic results use. Sponsored slots also use
    // /dp/ but tend to appear first; we accept either since we still
    // map to a real product the brand sells.
    const match = html.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Scrape basic product data from Amazon product page.
//
// Anti-bot resilience: Amazon's edge sometimes returns a stripped-down
// page (no productTitle, no gallery JSON) when it suspects a bot. The
// scraper used to silently return "all empty" data, which then poisoned
// the downstream pipeline (a fallback grabbed Amazon's nav-bar UI
// sprite as the "product image", and the image model rendered generic
// products). Two defences:
//   1. Send a more complete browser-realistic header set (Sec-Fetch-*,
//      Upgrade-Insecure-Requests) so we look like a real Chrome tab.
//   2. After parsing, if title/main-image/gallery are ALL empty, treat
//      it as a bot block and THROW. Callers' catch{} fires and the
//      pipeline falls through cleanly instead of using junk data.
//   3. Auto-retry once with a slightly different UA + referer if first
//      attempt looks blocked. Cheap insurance — most blocks are
//      transient and a second hit lands fine.
export async function fetchAmazonProduct(asin: string): Promise<AmazonProduct> {
  const url = `https://www.amazon.com/dp/${asin}`

  const fetchOnce = async (ua: string, referer: string | null): Promise<string> => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': referer ? 'cross-site' : 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',
        ...(referer ? { Referer: referer } : {}),
      },
    })
    if (!res.ok) throw new Error(`Amazon fetch failed: HTTP ${res.status}`)
    return res.text()
  }

  const UA_PRIMARY = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  const UA_RETRY = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

  let html = await fetchOnce(UA_PRIMARY, null)
  // Quick sanity check on the first body — if it's the bot-challenge
  // page Amazon doesn't include "productTitle" or the gallery JSON at
  // all, so do a tiny regex probe before paying the full parse cost.
  if (!/id="productTitle"|"hiRes"|landingImage/i.test(html)) {
    try {
      html = await fetchOnce(UA_RETRY, 'https://www.google.com/')
    } catch { /* keep first body */ }
  }

  // Title
  const titleMatch = html.match(/<span[^>]*id="productTitle"[^>]*>\s*([\s\S]*?)\s*<\/span>/)
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''

  // Bullet points
  const bulletsMatch = html.match(/<div[^>]*id="feature-bullets"[^>]*>([\s\S]*?)<\/div>/)
  const bullets: string[] = []
  if (bulletsMatch) {
    const liMatches = bulletsMatch[1].matchAll(/<li[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g)
    for (const m of liMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').trim()
      if (text && text.length > 5) bullets.push(text)
    }
  }

  // Description
  const descMatch = html.match(/<div[^>]*id="productDescription"[^>]*>([\s\S]*?)<\/div>/)
  const description = descMatch
    ? descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 1000)
    : ''

  // Price
  const priceMatch = html.match(/<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([\d,]+)<\/span>/)
  const price = priceMatch ? `$${priceMatch[1]}` : null

  // Rating
  const ratingMatch = html.match(/(\d+\.\d+)\s+out of\s+5\s+stars/)
  const rating = ratingMatch ? ratingMatch[1] : null

  // Image — prefer the CANONICAL main product image. The old `"large":"…"`
  // match grabbed the FIRST one on the page, which is often a related /
  // sponsored product (→ wrong product rendered). Priority:
  //   1. #landingImage data-old-hires — the main hi-res product photo
  //   2. og:image meta — Amazon sets this to the main product image
  //   3. first "hiRes" in the gallery JSON
  //   4. legacy "large" fallback
  const imageUrl =
    html.match(/id="landingImage"[^>]*\bdata-old-hires="(https:\/\/[^"]+)"/)?.[1] ||
    html.match(/\bdata-old-hires="(https:\/\/[^"]+)"[^>]*id="landingImage"/)?.[1] ||
    html.match(/<meta[^>]+property="og:image"[^>]+content="(https:\/\/[^"]+)"/)?.[1] ||
    html.match(/<meta[^>]+content="(https:\/\/[^"]+)"[^>]+property="og:image"/)?.[1] ||
    html.match(/"hiRes"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/)?.[1] ||
    html.match(/"large"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/)?.[1] ||
    null

  // Full gallery (hi-res) so callers can vision-pick the cleanest product
  // shot — the main image is often a multi-panel lifestyle collage.
  const galleryImages = Array.from(html.matchAll(/"hiRes"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/g)).map(m => m[1])
  const images = Array.from(new Set([imageUrl, ...galleryImages].filter((u): u is string => !!u))).slice(0, 8)

  // Bot-block detector: if NONE of the product fields were parseable
  // (no title, no main image, no gallery), Amazon almost certainly
  // returned a challenge / stripped page. Throw so the caller's catch
  // fires and the pipeline falls through to non-Amazon scraping
  // (or no-reference) instead of returning empty data that poisons
  // downstream image generation. Without this throw, the empty result
  // was passed through to fetchProductImageFromPage which then grabbed
  // Amazon's nav-bar UI sprite as the "product image".
  if (!title && !imageUrl && images.length === 0) {
    throw new Error(`Amazon returned non-product page for ASIN ${asin} (probable anti-bot block)`)
  }

  // Discount / deal signals — best-effort. Amazon renders these in a few
  // different shapes depending on the deal type, so we try each and bail
  // to null if nothing matches. Keep regexes loose; downstream prompts
  // gracefully handle "not detected" cases.
  //
  // 1. priceWas: the strike-through list price. Common shapes:
  //    <span class="a-price a-text-price"><span class="a-offscreen">$199.99</span>
  //    <span class="basisPrice"><span class="a-offscreen">$199.99</span>
  //    "wasPrice": "$199.99"
  const priceWasMatch =
    html.match(/<span[^>]*class="[^"]*a-text-price[^"]*"[^>]*>\s*<span[^>]*class="a-offscreen"[^>]*>\s*(\$[\d.,]+)/i) ||
    html.match(/"strikethroughPrice"\s*:\s*"(\$[\d.,]+)"/i) ||
    html.match(/"listPrice"\s*:\s*"(\$[\d.,]+)"/i) ||
    html.match(/List Price:[\s\S]{0,100}?(\$[\d.,]+)/i)
  const priceWas = priceWasMatch ? priceWasMatch[1] : null

  // 2. priceSale: the current sale price. We use the same value as `price`
  // above when a comparison priceWas is also present (because that IS the
  // sale price by definition). Without a priceWas, treat as null so callers
  // know the listing isn't on sale.
  const priceSale = priceWas && price ? price : null

  // 3. dealBadge: the textual deal label. Amazon uses several:
  //    "Lightning Deal", "Limited time deal", "Deal of the Day", "Coupon",
  //    "Prime Day Deal", "Black Friday Deal", "Cyber Monday Deal", "Save
  //    extra with coupon".
  const dealBadge =
    html.match(/>(Lightning Deal|Limited[- ]time deal|Deal of the Day|Prime Day Deal|Black Friday Deal|Cyber Monday Deal|Holiday Deal)</i)?.[1] ||
    (/with coupon/i.test(html) ? 'Coupon' : null)

  // 4. dealEndsAt: countdown / expiration. Several shapes:
  //    <span class="dealsTimer">Ends in 2d 4h</span> (relative)
  //    "endDate": "2026-07-16T23:59:59Z" (JSON island, most reliable)
  //    "Deal ends Jul 16" (plain text)
  let dealEndsAt: string | null = null
  const isoEnd = html.match(/"endDate"\s*:\s*"([^"]+)"/i) || html.match(/"endTime"\s*:\s*"([^"]+)"/i)
  if (isoEnd) {
    // Trust ISO-ish strings as-is; downstream parses with new Date().
    dealEndsAt = isoEnd[1]
  } else {
    const dateText = html.match(/Deal ends ([A-Za-z]+ \d{1,2}(?:,? \d{4})?)/i)
    if (dateText) dealEndsAt = dateText[1]
  }

  // 5. discountPct: "Save 32%" / "32% off" / "-32%"
  const pctMatch =
    html.match(/(?:Save|saving|You save)\s*(\d{1,2})\s*%/i) ||
    html.match(/-(\d{1,2})\s*%/) ||
    html.match(/(\d{1,2})\s*%\s*off/i)
  const discountPct = pctMatch ? Math.min(99, parseInt(pctMatch[1], 10)) : null

  return {
    asin,
    title,
    bullets: bullets.slice(0, 6),
    description,
    price,
    rating,
    imageUrl,
    images,
    priceWas,
    priceSale,
    dealBadge,
    dealEndsAt,
    discountPct,
  }
}

// ── Carousel-video probe ─────────────────────────────────────────────────────
// Returns true when the product's IMAGE CAROUSEL (the main gallery at the
// top of the product page) contains at least one video. Used by the
// /campaigns search to let users pre-filter to "products with a video the
// AI can grab a frame from" before queueing.
//
// Detection strategy: Amazon's image gallery is configured by an embedded
// JS island near the top of the page. Products with carousel videos have
// one of these signals:
//   - "videoUrl": "..."          ← canonical key in imageGalleryData / colorImages
//   - "videos":[{               ← array form when multiple videos exist
//   - data-video-url="..."       ← rendered into the thumbnail nav
//   - "videoBlock"               ← legacy gallery shape, still in use
//
// We DON'T match A+ content videos (those live further down the page in a
// separate `aplus-...` block) or "Customer videos" (in the reviews
// section) — both are out of carousel scope. The substring search is
// anchored to the imageBlock section to avoid false positives.
export type CarouselVideoVerdict =
  | 'has-video'
  | 'no-video'
  | 'fetch-failed'      // network error or non-200
  | 'bot-challenge'     // Amazon served the bot-check page, can't tell

export async function hasCarouselVideo(asin: string): Promise<boolean> {
  return (await probeCarouselVideo(asin)) === 'has-video'
}

/** Returns the full verdict for a single ASIN so callers can distinguish
 *  "product has no video" from "Amazon blocked us, we don't know". The
 *  boolean wrapper above maps the latter to false so legacy callers keep
 *  their old behavior. 2026-06-09: expanded patterns + UA rotation +
 *  bot-challenge sniffing after the first pass returned 0 matches on
 *  every keyword (Amazon was serving challenge pages from Vercel IPs). */
export async function probeCarouselVideo(asin: string): Promise<CarouselVideoVerdict> {
  const url = `https://www.amazon.com/dp/${asin}`
  // Rotate UA per ASIN to defeat per-UA rate limiting. Deterministic on
  // ASIN so retries land on the same UA + responses are reproducible.
  const UAS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ]
  const ua = UAS[(asin.charCodeAt(0) + asin.charCodeAt(asin.length - 1)) % UAS.length]
  let html = ''
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',
      },
      // 8s ceiling. Slightly more generous than the previous 6s — Amazon's
      // edge is sometimes slow + the cost of a false 'fetch-failed' is
      // higher than a slow probe (we lose otherwise-good candidates).
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 'fetch-failed'
    html = await res.text()
  } catch {
    return 'fetch-failed'
  }
  // Bot-challenge sniff: Amazon's challenge page is tiny and lacks the
  // product chrome. If we got NONE of these markers we're staring at
  // a challenge, not a real product page — flag it so the caller can
  // distinguish that from "page is real but has no video".
  const isProductPage = /id="productTitle"|landingImage|imageGalleryData|"hiRes"/i.test(html)
  if (!isProductPage) return 'bot-challenge'

  // Look at the first 150KB — covers the imageBlock JSON island + the
  // gallery thumbnails, well above A+ content and customer reviews
  // (where false-positive videos live).
  const head = html.slice(0, 150_000)

  // Carousel-video signals, in rough order of how reliable each is.
  // Tolerant of whitespace + quote-style variations.
  const patterns: RegExp[] = [
    /"mediaTypeCount"\s*:\s*\{[^}]*"video"\s*:\s*[1-9]/,      // explicit count
    /"videoUrl"\s*:\s*"https?:\/\//i,                          // canonical URL
    /"videoUrl"\s*:\s*"\/\//i,                                 // protocol-relative
    /"videos"\s*:\s*\[\s*\{/,                                  // videos array (objects)
    /"videos"\s*:\s*\[\s*"/,                                   // array-of-urls form
    /data-video-url\s*=\s*["']https?:\/\//i,                   // rendered attr
    /id\s*=\s*["']videoBlock["']/,                             // legacy block
    /class\s*=\s*["'][^"']*vse-video-player/i,                 // VSE player wrapper
    /"isVideo"\s*:\s*true/i,                                   // per-asset flag
  ]
  for (const p of patterns) {
    if (p.test(head)) return 'has-video'
  }
  return 'no-video'
}
