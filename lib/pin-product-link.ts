// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Resolve the "direct product link" a creator can opt a single Pinterest pin to
// instead of the blog post (the preview modal's Blog/Product toggle).
//
// ALWAYS THE FULL, UNSHORTENED LINK. Pinterest allows affiliate links with a
// clear disclosure (we always append one to the pin description), but its own
// help asks for the full affiliate URL, not a shortened one, and it blocks
// redirect domains it does not trust. It already blocked an mvpl.ink pin with
// "may lead to spam". Every rejection counts against the domain, and mvpl.ink
// is the same domain every creator's YouTube and Instagram links use, so a pin
// is the one place a Passport link must never go. So whatever the creator's
// Link style (Passport, Geniuslink, Bitly), the pin gets the tagged amazon.com
// URL, or the store page itself for a non-Amazon product. The one exception is
// a TikTok Showcase account, whose tiktok.com link is not a redirect. Returns
// null when there's no product to link to (the modal then disables the
// Product option and the pin stays on the blog link).
import { asinFromAmazonUrl, firstProductUrl } from '@/lib/product-link'
import { isSafePassportDestination } from '@/lib/passport-links'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { getLinkStyle, resolveShowcaseLink } from '@/lib/link-cloak'
import { extractAsin } from '@/services/amazon'
import { isBlockedPinLink } from '@/lib/pinterest-destination'

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

  let asin = (productUrl ? asinFromAmazonUrl(productUrl) : null)
    || extractAsin(`${productUrl || ''} ${title}`)

  // A stored geni.us / Passport / short link carries no ASIN in the string, so the above
  // finds nothing and the pin would be left on the short link. Unwrap it via
  // its PUBLIC redirect to recover the real product.
  let unwrapped: string | null = null
  if (!asin && productUrl && /(?:geni\.us|\bgnz\.|mvpl\.ink|\/go\/[a-z0-9]+|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(productUrl)) {
    try {
      const finalUrl = await resolveTrueDestination(productUrl)
      asin = asinFromAmazonUrl(finalUrl)
      if (!asin && !/amazon\.[a-z.]+/i.test(finalUrl) && isSafePassportDestination(finalUrl)) unwrapped = finalUrl
    } catch { /* redirect unreachable — keep the original link */ }
  }
  // Once unwrapped to a real non-Amazon store page, use THAT as the
  // destination, never the short link.
  if (unwrapped) productUrl = unwrapped

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

  // A TikTok Showcase account links its own tiktok.com page (migration 333),
  // which is not a redirect. Null on an Amazon account.
  const cfg = await getLinkStyle(supabase, userId)
  const showcase = await resolveShowcaseLink(supabase, userId, cfg, { source: 'pinterest' })
  if (showcase) return showcase
  // Last guard: a stored short link that could not be unwrapped is not sent.
  return isBlockedPinLink(dest) ? null : dest
}
