export interface AmazonProduct {
  asin: string
  title: string
  bullets: string[]
  description: string
  price: string | null
  rating: string | null
  imageUrl: string | null
}

// Extract ASIN from YouTube video title — must be a 10-char uppercase alphanumeric string
export function extractAsin(text: string): string | null {
  const match = text.match(/\b([A-Z0-9]{10})\b/)
  return match ? match[1] : null
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

// Scrape basic product data from Amazon product page
export async function fetchAmazonProduct(asin: string): Promise<AmazonProduct> {
  const url = `https://www.amazon.com/dp/${asin}`

  const res = await fetch(url, {
    headers: {
      // Mimic a real browser to avoid bot detection
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
  })

  if (!res.ok) throw new Error(`Amazon fetch failed: HTTP ${res.status}`)
  const html = await res.text()

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

  return { asin, title, bullets: bullets.slice(0, 6), description, price, rating, imageUrl }
}
