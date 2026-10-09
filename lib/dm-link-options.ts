// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LINK AN AUTO-DM SENDS, PICKED FOR THE CREATOR (Seb, 2026-10-09: "could MVP
// automatically attach the correct link to DM, usually a choice between the
// blog post, the link in bio page or the direct affiliate link"). The Post to
// Instagram window opened with an empty link box, so every Auto-DM Reel meant
// finding and pasting a link by hand.
//
// From the video (Shorts Studio) or the product link (Clip Factory), this works
// out each of the three that exists for that product. A choice that does not
// exist is left out rather than shown empty, so the window only offers links
// that work.

import { asinFromAmazonUrl } from '@/lib/asin'
import { extractAsin } from '@/services/amazon'
import { productPageUrl } from '@/lib/pinterest-destination'
import { resolveCloakedLink } from '@/lib/link-cloak'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { postProductAsin } from '@/lib/post-product-link'

/** Short and cloaked links that carry no ASIN until they are followed. */
const SHORT_LINK = /(?:geni\.us|\bgnz\.|mvpl\.ink|\/go\/[a-z0-9]+|amzn\.to|a\.co\/|bit\.ly|tinyurl\.com|rebrand\.ly)/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type DmLinkKind = 'shop' | 'blog' | 'amazon'
export type DmLinkOption = { kind: DmLinkKind; url: string; label: string; note: string }
export type DmLinkOptions = { asin: string | null; title: string; options: DmLinkOption[] }

/** The order the choices are shown in, and the first-time default. */
export const DM_LINK_ORDER: DmLinkKind[] = ['shop', 'blog', 'amazon']

/** The choice to preselect: the creator's last pick when it exists for this
 *  product, else the first available in DM_LINK_ORDER. Pure. */
export function pickDmLink(options: DmLinkOption[], last: string | null | undefined): DmLinkOption | null {
  return options.find((o) => o.kind === last) ?? DM_LINK_ORDER.map((k) => options.find((o) => o.kind === k)).find(Boolean) ?? null
}

function origin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/+$/, '')
}

export async function dmLinkOptions(db: Db, userId: string, input: { videoId?: string | null; product?: string | null }): Promise<DmLinkOptions> {
  let asin: string | null = null
  let title = ''
  let productUrl = String(input.product ?? '').trim()
  let blogUrl: string | null = null
  let blogAsin: string | null = null

  // The video: its product and its blog post.
  const videoId = String(input.videoId ?? '').trim()
  if (videoId) {
    try {
      const { data: v } = await db.from('youtube_videos').select('id,title,asin,product_url')
        .eq('id', videoId).eq('user_id', userId).maybeSingle()
      if (v) {
        title = String(v.title ?? '')
        asin = (String(v.asin ?? '').trim().toUpperCase() || null)
        if (!productUrl) productUrl = String(v.product_url ?? '').trim()
      }
    } catch { /* no video row */ }
    try {
      const { data: p } = await db.from('blog_posts').select('wordpress_url,content')
        .eq('user_id', userId).eq('video_id', videoId).not('wordpress_url', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      const u = String(p?.wordpress_url ?? '').trim()
      if (/^https?:\/\//i.test(u)) blogUrl = u
      blogAsin = p ? postProductAsin(p) : null
    } catch { /* no post */ }
  }
  if (!asin && productUrl) asin = asinFromAmazonUrl(productUrl) || extractAsin(productUrl)
  // A SHORT LINK IS FOLLOWED TO ITS PRODUCT (Seb, 2026-10-09: the Link in Bio
  // choice fell back to the whole shop because the video's product link was a
  // geni.us / mvpl.ink / amzn.to link, which names no ASIN until followed).
  if (!asin && productUrl && SHORT_LINK.test(productUrl)) {
    try { asin = asinFromAmazonUrl(await resolveTrueDestination(productUrl)) } catch { /* unreachable redirect */ }
  }
  // The blog post for the video names the product too.
  if (!asin && blogAsin) asin = blogAsin
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) asin = null

  const options: DmLinkOption[] = []

  // The Link in Bio product page (or the whole shop when the product is unknown).
  try {
    const { data: page } = await db.from('link_pages').select('handle,published').eq('user_id', userId).maybeSingle()
    const handle = String(page?.handle ?? '').trim()
    if (handle && page?.published !== false) {
      options.push(asin
        ? { kind: 'shop', url: productPageUrl(origin(), handle, asin), label: 'Link in Bio page', note: 'This product’s page in your shop. MVP adds the product to it when you post.' }
        : { kind: 'shop', url: `${origin()}/shop/${encodeURIComponent(handle)}`, label: 'Link in Bio shop', note: 'Your whole shop: MVP could not tell which product this video is about.' })
    }
  } catch { /* no shop page */ }

  if (blogUrl) options.push({ kind: 'blog', url: blogUrl, label: 'Blog post', note: 'The review on your blog for this video.' })

  // The affiliate link, in the creator's own link style (Passport and the rest).
  if (asin) {
    try {
      const { data: integ } = await db.from('integrations').select('amazon_associates_tag').eq('user_id', userId).maybeSingle()
      const tag = String(integ?.amazon_associates_tag ?? '').trim()
      const dest = tag ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asin}`
      const url = await resolveCloakedLink({ supabase: db, userId, destination: dest, asin, channel: 'instagram', source: 'instagram', label: title || null })
      if (/^https?:\/\//i.test(url)) options.push({ kind: 'amazon', url, label: 'Amazon link', note: 'Straight to the product on Amazon, in your link style.' })
    } catch { /* no affiliate link */ }
  } else if (/^https?:\/\//i.test(productUrl)) {
    options.push({ kind: 'amazon', url: productUrl, label: 'Product link', note: 'The product link you gave this clip.' })
  }

  return { asin, title, options }
}
