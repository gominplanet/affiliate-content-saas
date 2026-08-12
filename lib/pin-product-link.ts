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
import { asinFromAmazonUrl } from '@/lib/product-link'
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
  // The product this post is about lives on its linked video (product_url/title).
  let productUrl: string | null = null
  let title = (p?.title as string) || ''
  const videoId = (p as { video_id?: string | null })?.video_id
  if (videoId) {
    try {
      const { data: v } = await supabase
        .from('youtube_videos').select('product_url,title').eq('id', videoId).maybeSingle()
      productUrl = (v?.product_url as string | null)?.trim() || null
      title = (v?.title as string) || title
    } catch { /* fall through to title-based ASIN */ }
  }

  const asin = (productUrl ? asinFromAmazonUrl(productUrl) : null)
    || extractAsin(`${productUrl || ''} ${title}`)
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

  // Prefer the user's Geniuslink when configured (Amazon ASIN only). Best-effort:
  // Geniuslink's create endpoint is flaky, so fall back to the tagged direct URL.
  const gKey = ((ig?.geniuslink_api_key as string) || '').trim()
  const gSecret = ((ig?.geniuslink_api_secret as string) || '').trim()
  if (asin && gKey && gSecret) {
    try {
      const svc = createGeniuslinkService(gKey, gSecret)
      const { url } = await getOrCreateAmazonGeniuslink({ userId, asin, destination: dest, service: svc })
      if (url && /^https?:\/\//i.test(url)) return url
    } catch { /* Geniuslink unavailable — use the tagged direct link */ }
  }
  return dest
}
