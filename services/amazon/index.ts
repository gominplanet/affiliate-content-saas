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

  // Image
  const imgMatch = html.match(/"large"\s*:\s*"(https:\/\/[^"]+\.jpg[^"]*)"/);
  const imageUrl = imgMatch ? imgMatch[1] : null

  return { asin, title, bullets: bullets.slice(0, 6), description, price, rating, imageUrl }
}
