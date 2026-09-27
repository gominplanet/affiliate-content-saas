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
import { isBlockedPinLink, type PinProductDest } from '@/lib/pinterest-destination'
import { readPinSettings } from '@/lib/pinterest-pin-dest-server'
import { productPageForPin, type PinIntegration } from '@/lib/amazon-pin-publish'

export async function resolvePinProductLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ig: any,
): Promise<string | null> {
  return (await resolvePinProduct(supabase, userId, p, ig)).url
}

/** The product a blog post is about: its ASIN, name, and the full product link a pin may carry. */
export async function resolvePinProduct(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ig: any,
): Promise<{ url: string | null; asin: string | null; title: string }> {
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

  // The Pinterest tracking ID when the creator set one (migration 382), so
  // Amazon's reports show what Pinterest earns; else the main tag.
  const settings = await readPinSettings(supabase, userId)
  const tag = (settings.pinterestTag || (ig?.amazon_associates_tag as string) || '').trim()

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
  if (!dest) return { url: null, asin: asin || null, title }

  // A TikTok Showcase account links its own tiktok.com page (migration 333),
  // which is not a redirect. Null on an Amazon account.
  const cfg = await getLinkStyle(supabase, userId)
  const showcase = await resolveShowcaseLink(supabase, userId, cfg, { source: 'pinterest' })
  if (showcase) return { url: showcase, asin: asin || null, title }
  // Last guard: a stored short link that could not be unwrapped is not sent.
  return { url: isBlockedPinLink(dest) ? null : dest, asin: asin || null, title }
}

export type BlogPinTarget = 'blog' | 'product' | 'shop'

/** A blog pin's default target, from the creator's setting (migration 382). */
export function blogPinTargetFor(pref: PinProductDest): BlogPinTarget {
  return pref === 'amazon' ? 'product' : pref === 'link_in_bio' ? 'shop' : 'blog'
}

/**
 * Where one blog pin goes. 'blog' is the post itself (url null: the pin keeps
 * the post's own link). 'product' is the full Amazon link. 'shop' is the
 * product's page on Link in Bio, with the product put on it first. A target
 * that is not available falls back to the blog post and says why.
 */
export async function blogPinLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string, p: any, ig: any, target: BlogPinTarget | 'default',
): Promise<{ url: string | null; target: BlogPinTarget; note: string | null }> {
  const want: BlogPinTarget = target === 'default' ? blogPinTargetFor((await readPinSettings(supabase, userId)).pref) : target
  if (want === 'blog') return { url: null, target: 'blog', note: null }
  const prod = await resolvePinProduct(supabase, userId, p, ig).catch(() => ({ url: null, asin: null, title: '' }))
  if (want === 'product') {
    return prod.url ? { url: prod.url, target: 'product', note: null } : { url: null, target: 'blog', note: 'No product link was found in this post, so the pin goes to the blog post.' }
  }
  if (!prod.asin) return { url: null, target: 'blog', note: 'This post has no Amazon product MVP could find, so the pin goes to the blog post.' }
  const page = await productPageForPin({ userId, intRow: ig as PinIntegration, asin: prod.asin, productTitle: prod.title })
  return page.url ? { url: page.url, target: 'shop', note: null } : { url: null, target: 'blog', note: `${page.note} The pin goes to the blog post.` }
}
