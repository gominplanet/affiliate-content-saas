// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHERE THE SCRIPT AGENT READS THE BUYERS ON MVP'S SERVER (lib/trybe-playbook
// scriptCraft): a short link followed to where it goes, and a TikTok Shop
// product with the reviews its own page carries. Shared by Video Scripts
// and TRYBE's scripts. Amazon's reviews are read by SCOUT in the creator's
// own Chrome, never here.

import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { parseTikTokProduct } from '@/lib/tiktok-product'
import { SHORT_HOSTS, tiktokReviewsFrom, type ProductFacts } from '@/lib/product-scripts'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Where a short link goes, followed only through short-link hosts, so MVP's
 *  server never fetches a page the creator named. */
export async function followShort(url: string): Promise<string | null> {
  let at = url
  for (let hop = 0; hop < 5; hop++) {
    let host = ''
    try { host = new URL(at).hostname } catch { return null }
    if (!SHORT_HOSTS.test(host)) return at
    try {
      const res = await fetchWithTimeout(at, { timeoutMs: 8000, redirect: 'manual', headers: { 'User-Agent': UA } })
      const loc = res.headers.get('location')
      if (!loc) return null
      at = new URL(loc, at).toString()
    } catch { return null }
  }
  return null
}

/** A TikTok Shop product and the reviews its page carries. */
export async function readTikTok(url: string): Promise<{ facts: ProductFacts; reviews: ReturnType<typeof tiktokReviewsFrom> } | null> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 12000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } })
    if (!res.ok) return null
    const html = await res.text()
    const p = parseTikTokProduct(html, url)
    if (!p) return null
    return {
      facts: {
        name: p.title, store: 'tiktok', description: p.description, rating: p.rating, reviewCount: p.reviewCount, soldCount: p.soldCount,
        seller: p.sellerName, price: p.price ? `${p.currencySymbol || ''}${p.price}` : null,
      },
      reviews: tiktokReviewsFrom(html),
    }
  } catch { return null }
}

