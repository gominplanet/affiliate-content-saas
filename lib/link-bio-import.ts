/**
 * addPostedProductToBio — auto-append the product from a Clip Factory post to the
 * creator's Link in Bio shop page, when they've opted in (link_pages.auto_import_posts).
 *
 * Called best-effort from the Direct Post endpoints right after a Short is posted
 * to TikTok / Instagram, so the product lands on the bio page without the creator
 * clicking "Import my posted products". It mirrors the per-tile link building the
 * bulk sync uses (Passport → Geniuslink → tagged Amazon), for one product.
 *
 * NEVER throws: a failure here must not fail the publish. Returns true if a tile
 * was added, false otherwise (opted out, no page, no product, already present).
 */
import { resolveAffiliateUrl } from '@/lib/weekly-digest'
import { getLinkStyle } from '@/lib/link-cloak'
import { passportLinkForUser } from '@/lib/passport-links'
import { asinFromAmazonUrl } from '@/lib/product-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const usableUrl = (u: string) => /^https?:\/\//i.test(u) && /(amazon\.|amzn\.to|a\.co|geni\.us)/i.test(u)

export async function addPostedProductToBio(sb: Sb, userId: string, videoId: string): Promise<boolean> {
  try {
    // Opt-in check first — cheap, and the common case is "off", so bail early.
    const { data: page } = await sb.from('link_pages')
      .select('id, auto_import_posts').eq('user_id', userId).maybeSingle()
    if (!page?.id || !page.auto_import_posts) return false

    // The product + a photo live on the posted video row.
    const { data: video } = await sb.from('youtube_videos')
      .select('title, product_url, product_image_url, blog_thumbnail_url, thumbnail_url')
      .eq('id', videoId).eq('user_id', userId).maybeSingle()
    const purl = ((video?.product_url as string | null) || '').trim()
    if (!purl) return false

    const title = ((video?.title as string | null) || 'Product').slice(0, 120)
    const image_url = (video?.product_image_url as string | null)
      || (video?.blog_thumbnail_url as string | null)
      || (video?.thumbnail_url as string | null)
      || null
    const asin = asinFromAmazonUrl(purl)
    const asinU = asin ? asin.toUpperCase() : null
    if (asinU && !/^[A-Z0-9]{10}$/.test(asinU)) return false
    // No ASIN and not a usable affiliate link → nothing we can safely link to.
    if (!asinU && !usableUrl(purl)) return false

    // Dedupe against what's already on the page (by ASIN, else by URL).
    if (asinU) {
      const { data: dup } = await sb.from('link_page_items')
        .select('id').eq('page_id', page.id).eq('asin', asinU).maybeSingle()
      if (dup) return false
    } else {
      const { data: dup } = await sb.from('link_page_items')
        .select('id').eq('page_id', page.id).eq('url', purl).maybeSingle()
      if (dup) return false
    }

    // Append after the current last tile.
    const { data: last } = await sb.from('link_page_items')
      .select('position').eq('page_id', page.id)
      .order('position', { ascending: false }).limit(1).maybeSingle()
    const position = (last?.position ?? -1) + 1

    // Build the destination link. For an ASIN, wrap through the creator's chosen
    // Link style (Passport geo-routes, else Geniuslink/Bitly/tagged); a link-only
    // product (already geni.us) is used as-is.
    let url = purl
    if (asinU) {
      const { data: intRow } = await sb.from('integrations')
        .select('amazon_associates_tag, geniuslink_api_key, geniuslink_api_secret')
        .eq('user_id', userId).maybeSingle()
      const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null
      const gKey = ((intRow?.geniuslink_api_key as string | null) || '').trim() || null
      const gSecret = ((intRow?.geniuslink_api_secret as string | null) || '').trim() || null
      const passport = await passportLinkForUser(sb, userId, asinU, { source: 'linkbio', title })
      if (passport) {
        url = passport
      } else {
        const linkCfg = await getLinkStyle(sb, userId)
        url = await resolveAffiliateUrl(asinU, title, tag, gKey, gSecret, userId, linkCfg)
          || (tag ? `https://www.amazon.com/dp/${asinU}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asinU}`)
      }
    }

    const { data: ins } = await sb.from('link_page_items')
      .upsert(
        { page_id: page.id, user_id: userId, kind: 'product', title, image_url, url, asin: asinU, source: 'social', position },
        { onConflict: 'page_id,asin', ignoreDuplicates: true },
      )
      .select('id')
    return !!(ins && ins.length)
  } catch (err) {
    console.warn('[link-bio-import] auto-append skipped:', err instanceof Error ? err.message : err)
    return false
  }
}
