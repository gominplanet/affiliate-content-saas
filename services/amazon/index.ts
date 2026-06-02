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

  return { asin, title, bullets: bullets.slice(0, 6), description, price, rating, imageUrl, images }
}
