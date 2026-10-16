/**
 * Auto-append a product to the creator's Link in Bio shop page when they've
 * opted in (link_pages.auto_import_posts). Two entry points share one core:
 *
 *   addPostedProductToBio(sb, userId, videoId)      — resolve the product from a
 *       posted youtube_videos row (the Direct Post endpoints use this).
 *   addProductUrlToBio(sb, userId, { url, title })  — a raw product URL, for
 *       Clip Factory's burned-clip publish (TikTok / Instagram), where there's
 *       no youtube_videos row, just the link the creator typed in Enhance.
 *
 * Called best-effort right after a Short is posted, so the product lands on the
 * bio page without the creator clicking "Import my posted products". Per-tile
 * link building mirrors the bulk sync (Passport → Geniuslink → tagged Amazon).
 *
 * NEVER throws: a failure here must not fail the publish. Returns true if a tile
 * was added, false otherwise (opted out, no page, no product, already present).
 */
import { resolveAffiliateUrl } from '@/lib/weekly-digest'
import { getLinkStyle } from '@/lib/link-cloak'
import { passportLinkForUser } from '@/lib/passport-links'
import { asinFromAmazonUrl } from '@/lib/product-link'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { syncLinkInBioTile } from '@/lib/amazon-social-publish'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const usableUrl = (u: string) => /^https?:\/\//i.test(u) && /(amazon\.|amzn\.to|a\.co|geni\.us)/i.test(u)

/** A caption that sends people to the Link in Bio page (Seb, 2026-10-16: "it
 *  was sent to TikTok with the link in bio tag, MVP should have automatically
 *  added the product"). A post that says this must find the product there,
 *  whatever the auto-import setting. */
export const CAPTION_SENDS_TO_BIO = /\blink (?:is )?in (?:my |the )?bio\b/i

/** What happened to the Link in Bio page, said to the creator after the post.
 *  An empty note means nothing worth saying (auto-import off, no bio caption). */
export interface BioOutcome { state: 'added' | 'off' | 'no-page' | 'no-product' | 'failed'; note: string }
const quiet: BioOutcome = { state: 'off', note: '' }

/**
 * The shared core: page and opt-in check, the tracked link, then the tile
 * through the one writer every path uses (lib/amazon-social-publish
 * syncLinkInBioTile: newest first, error read, a picture, page refreshed).
 * `force` is a caption that says "link in bio": the product goes on the page
 * even with auto-import off, and every reason it could not is said.
 */
async function appendProductToBio(
  sb: Sb,
  userId: string,
  product: { url: string; title: string; image_url: string | null },
  force: boolean,
): Promise<BioOutcome> {
  const { data: page } = await sb.from('link_pages')
    .select('id, auto_import_posts, handle').eq('user_id', userId).maybeSingle()
  if (!page?.id) return force ? { state: 'no-page', note: 'Your caption says link in bio, but you have no Link in Bio page in MVP yet, so the product is not on one. Set it up under Link in Bio.' } : quiet
  if (!force && !page.auto_import_posts) return quiet

  const purl = (product.url || '').trim()
  const title = (product.title || 'Product').slice(0, 120)
  const asin = purl ? asinFromAmazonUrl(purl) : null
  const asinU = asin && /^[A-Z0-9]{10}$/.test(asin.toUpperCase()) ? asin.toUpperCase() : null
  if (!asinU) {
    // A link with no ASIN (a geni.us link) cannot be matched to a product tile
    // safely, so it is said rather than guessed.
    return force ? { state: 'no-product', note: purl && usableUrl(purl)
      ? 'Your caption says link in bio, but MVP could not tell which Amazon product this link is, so it was not added to your Link in Bio page. Add it there by hand.'
      : 'Your caption says link in bio, but MVP has no product link for this clip, so nothing was added to your Link in Bio page. Add the product there by hand.' } : quiet
  }

  // The destination: the creator's chosen link style (Passport geo-routes,
  // else Geniuslink/Bitly/tagged Amazon).
  const { data: intRowRaw } = await sb.from('integrations')
    .select('amazon_associates_tag, geniuslink_api_key, geniuslink_api_secret')
    .eq('user_id', userId).maybeSingle()
  // Secret columns on this row are encrypted at rest. Decrypt before use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intRow = decryptIntegrationRow(intRowRaw as any)
  const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null
  const gKey = ((intRow?.geniuslink_api_key as string | null) || '').trim() || null
  const gSecret = ((intRow?.geniuslink_api_secret as string | null) || '').trim() || null
  let url = await passportLinkForUser(sb, userId, asinU, { source: 'linkbio', title })
  if (!url) {
    const linkCfg = await getLinkStyle(sb, userId)
    url = await resolveAffiliateUrl(asinU, title, tag, gKey, gSecret, userId, linkCfg)
      || (tag ? `https://www.amazon.com/dp/${asinU}?tag=${encodeURIComponent(tag)}` : `https://www.amazon.com/dp/${asinU}`)
  }
  const err = await syncLinkInBioTile(sb, userId, { asin: asinU, title, imageUrl: product.image_url || undefined, url }, false)
  if (err) return { state: 'failed', note: err }
  return { state: 'added', note: `${title.length > 60 ? `${title.slice(0, 57)}...` : title} is at the top of your Link in Bio page.` }
}

/** The product of a posted video row (youtube_videos.id), for the Short paths. */
export async function addPostedProductToBio(sb: Sb, userId: string, videoId: string, opts: { caption?: string } = {}): Promise<BioOutcome> {
  try {
    const force = CAPTION_SENDS_TO_BIO.test(opts.caption || '')
    const { data: video } = await sb.from('youtube_videos')
      .select('title, product_url, product_image_url, blog_thumbnail_url, thumbnail_url')
      .eq('id', videoId).eq('user_id', userId).maybeSingle()
    return await appendProductToBio(sb, userId, {
      url: ((video?.product_url as string | null) || '').trim(),
      title: (video?.title as string | null) || 'Product',
      image_url: (video?.product_image_url as string | null) || (video?.blog_thumbnail_url as string | null) || (video?.thumbnail_url as string | null) || null,
    }, force)
  } catch (err) {
    console.warn('[link-bio-import] auto-append skipped:', err instanceof Error ? err.message : err)
    return { state: 'failed', note: 'The post went out, but MVP could not update your Link in Bio page. Add the product there by hand.' }
  }
}

/**
 * Clip Factory's burned-clip publish (TikTok / Instagram): the link the
 * creator typed in Enhance, else the product of the YouTube video the clip
 * came from (Seb, 2026-10-16: no link was typed, so nothing was added).
 * Best-effort, never throws.
 */
export async function addProductUrlToBio(
  sb: Sb,
  userId: string,
  product: { url?: string | null; title?: string | null; image_url?: string | null },
  opts: { caption?: string; sourceYoutubeVideoId?: string | null } = {},
): Promise<BioOutcome> {
  try {
    const force = CAPTION_SENDS_TO_BIO.test(opts.caption || '')
    let url = (product.url || '').trim()
    let title = (product.title || '').trim()
    let image = product.image_url || null
    const yt = (opts.sourceYoutubeVideoId || '').trim()
    if (!url && /^[\w-]{11}$/.test(yt)) {
      const { data: video } = await sb.from('youtube_videos')
        .select('title, product_url, product_image_url, thumbnail_url')
        .eq('user_id', userId).eq('youtube_video_id', yt).maybeSingle()
      url = ((video?.product_url as string | null) || '').trim()
      title = title || ((video?.title as string | null) || '')
      image = image || (video?.product_image_url as string | null) || (video?.thumbnail_url as string | null) || null
    }
    return await appendProductToBio(sb, userId, { url, title: title || 'Product', image_url: image }, force)
  } catch (err) {
    console.warn('[link-bio-import] auto-append (url) skipped:', err instanceof Error ? err.message : err)
    return { state: 'failed', note: 'The post went out, but MVP could not update your Link in Bio page. Add the product there by hand.' }
  }
}
