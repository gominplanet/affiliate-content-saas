// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Resolve the "direct product link" a creator can opt a single Pinterest pin to
// instead of the blog post (the preview modal's Blog/Product toggle).
//
// Pinterest allows affiliate links WITH a clear disclosure (we always append one
// to the pin description) and prefers unmasked destinations. Per the product
// rule: when the user has Geniuslink configured, use their Geniuslink (their own
// managed, disclosed affiliate link); otherwise use the tagged direct Amazon URL.
// Returns null when there's no product to link to (the modal then disables the
// Product option and the pin stays on the blog link).
import { asinFromAmazonUrl, firstProductUrl } from '@/lib/product-link'
import { passportLinkForUser } from '@/lib/passport-links'
import { getLinkStyle } from '@/lib/link-cloak'
import { shortenBitly } from '@/lib/bitly'
import { extractAsin } from '@/services/amazon'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getOrCreateAmazonGeniuslink } from '@/lib/geniuslink-cache'

export async function resolvePinProductLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ig: any,
): Promise<string | null> {
  // The product this post is about: prefer its linked video's product_url
  // (single-product reviews), else the first product link in the article body
  // (guides / comparisons / from-link posts have no video but DO carry the
  // affiliate link in their content — often already the user's geni.us/tagged
  // link, which is exactly the direct product destination we want).
  let productUrl: string | null = null
  let title = (p?.title as string) || ''
  const videoId = (p as { video_id?: string | null })?.video_id
  if (videoId) {
    try {
      const { data: v } = await supabase
        .from('youtube_videos').select('product_url,title').eq('id', videoId).maybeSingle()
      productUrl = (v?.product_url as string | null)?.trim() || null
      title = (v?.title as string) || title
    } catch { /* fall through to content / title-based ASIN */ }
  }
  if (!productUrl) {
    const content = (p?.content as string | null) || ''
    if (content) {
      try { productUrl = firstProductUrl(content, (p?.wordpress_url as string | null) || null) } catch { /* none in body */ }
    }
  }

  const asin = (productUrl ? asinFromAmazonUrl(productUrl) : null)
    || extractAsin(`${productUrl || ''} ${title}`)

  // Passport Links (geo-routing) wins WHEN ON. Off → null and we fall through to
  // the Geniuslink / tagged-direct link below unchanged.
  if (asin) {
    try {
      const p = await passportLinkForUser(supabase, userId, asin, { source: 'pinterest', title })
      if (p) return p
    } catch { /* fall through */ }
  }
  const tag = ((ig?.amazon_associates_tag as string) || '').trim()

  // Tagged direct Amazon destination when we know the ASIN; else a non-Amazon
  // product page the user set, as-is.
  let dest: string | null = null
  if (asin) {
    dest = tag
      ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}`
      : `https://www.amazon.com/dp/${asin}`
  } else if (productUrl && /^https?:\/\//i.test(productUrl)) {
    dest = productUrl
  }
  if (!dest) return null

  // Apply the creator's ONE chosen Link style. Geniuslink only when they picked
  // it (Amazon ASIN only); Bitly shortens the direct link; otherwise the tagged
  // direct URL. Passport was already handled above (it wins when it's the style).
  const cfg = await getLinkStyle(supabase, userId)
  if (cfg.style === 'bitly' && cfg.bitlyToken) {
    const short = await shortenBitly(cfg.bitlyToken, dest)
    return short || dest
  }
  const gKey = ((ig?.geniuslink_api_key as string) || '').trim()
  const gSecret = ((ig?.geniuslink_api_secret as string) || '').trim()
  if (cfg.style === 'geniuslink' && asin && gKey && gSecret) {
    // Best-effort: Geniuslink's create endpoint is flaky, so fall back to the
    // tagged direct URL.
    try {
      const svc = createGeniuslinkService(gKey, gSecret)
      const { url } = await getOrCreateAmazonGeniuslink({ userId, asin, destination: dest, service: svc })
      if (url && /^https?:\/\//i.test(url)) return url
    } catch { /* Geniuslink unavailable — use the tagged direct link */ }
  }
  return dest
}
