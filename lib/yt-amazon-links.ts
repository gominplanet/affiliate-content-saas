// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH PRODUCTS A YOUTUBE VIDEO LINKS TO (lib/yt-amazon-match; Seb,
// 2026-11-11). From its title (a B0 ASIN written in it) and its description:
// an Amazon product link is read as it is; any other product link (geni.us,
// amzn.to, a.co, a branded short link) is followed, hop by hop, until it shows
// an ASIN. Following STOPS at any Amazon address: the ASIN is read from the
// address itself, and Amazon's own pages are never fetched. Every hop is
// checked as a public address first, and MVP says who it is.
// Server only.

import { allProductUrls, RESOLVER_UA } from '@/lib/product-link'
import { asinFromAmazonUrl } from '@/lib/asin'
import { assertPublicHttpUrlResolved } from '@/lib/ssrf-guard'
import { titleAsins } from '@/lib/yt-amazon-match'

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.com$/i

/** Where one link leads: an ASIN, or why not. Never throws. */
export async function followToAsin(url: string): Promise<{ asin: string } | { why: 'amazon-not-product' | 'elsewhere' | 'link-failed'; host: string }> {
  let current = url
  let host = ''
  for (let hop = 0; hop <= 5; hop++) {
    const a = asinFromAmazonUrl(current)
    if (a) return { asin: a }
    try { host = new URL(current).hostname.toLowerCase() } catch { return { why: 'link-failed', host } }
    // Amazon itself is never fetched: an Amazon address with no ASIN is a
    // storefront, a search or a list, not one product.
    if (AMAZON_HOST.test(host)) return { why: 'amazon-not-product', host }
    try { await assertPublicHttpUrlResolved(current) } catch { return { why: 'link-failed', host } }
    let res: Response
    try {
      res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': RESOLVER_UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(6000) })
    } catch { return { why: 'link-failed', host } }
    try { await res.body?.cancel() } catch { /* nothing to read */ }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { why: 'link-failed', host }
      try { current = new URL(loc, current).toString() } catch { return { why: 'link-failed', host } }
      continue
    }
    if (!res.ok && res.status !== 206 && res.status !== 416) return { why: 'link-failed', host }
    return { why: 'elsewhere', host }
  }
  return { why: 'link-failed', host }
}

/** The ASINs a video links to, in the order they appear, with where each came
 *  from; or, when none, why (lib/yt-amazon-match whyWords). */
export async function productsOfVideo(title: string, description: string, maxFollow = 6): Promise<{ asins: Array<{ asin: string; via: string }>; why: string | null }> {
  const found = new Map<string, string>()
  for (const a of titleAsins(title)) found.set(a, 'title')
  const text = String(description || '')
  const elsewhere = new Set<string>()
  let failed = 0
  let notProduct = 0
  let followed = 0
  for (const u of allProductUrls(text, null, 16)) {
    const direct = asinFromAmazonUrl(u)
    if (direct) { if (!found.has(direct)) found.set(direct, u.slice(0, 300)); continue }
    if (followed >= maxFollow) continue
    followed++
    const r = await followToAsin(u)
    if ('asin' in r) { if (!found.has(r.asin)) found.set(r.asin, u.slice(0, 300)) }
    else if (r.why === 'elsewhere') elsewhere.add(r.host.replace(/^www\./, ''))
    else if (r.why === 'amazon-not-product') notProduct++
    else failed++
  }
  if (found.size) return { asins: Array.from(found, ([asin, via]) => ({ asin, via })), why: null }
  // A storefront link is dropped as "not a product" before it is followed.
  if (!notProduct && /amazon\.[a-z.]+\/(shop|stores|s\?|b\?)/i.test(text)) notProduct = 1
  const why = elsewhere.size ? `elsewhere:${Array.from(elsewhere).slice(0, 4).join(',')}` : notProduct ? 'amazon-not-product' : failed ? 'link-failed' : 'no-link'
  return { asins: [], why }
}
