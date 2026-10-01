// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DESCRIPTION OF A FACEBOOK REEL.
//
// A Reel's description is the only place its link can go: there is no link
// card, no shop, and Facebook does not make on-video text clickable. The first
// Reel MVP posted went out as its hook ("CHIA WORTH IT?") and nothing else,
// because the page sent the clip's caption and the caption had no link in it.
//
// So the description is built here, on the server, from what MVP knows about
// the clip's source video, in this order:
//   1. the product link in that video's blog post (the creator's live link,
//      re-minted for Facebook in their link style, as the blog's Facebook
//      share does);
//   2. the product typed in Enhance (an Amazon link, an ASIN, or any store URL);
//   3. the ASIN recorded on the video itself.
// Then the full review (the long video or the blog post, per the creator's
// Facebook link setting), and the disclosure.
//
// The product link is always included when there is one, whatever the Facebook
// setting says for blog shares: a blog share has a link card to fall back on,
// a Reel has nothing else.
//
// WHAT HAPPENED IS RETURNED, not just the text: whether a product link was
// found, where it came from, and why it is plain when the link style could not
// be applied, so the page can say "no product link" before anything posts.

import { getLinkStyle, resolveCloakedLinkDetailed, cloakFallbackNote } from '@/lib/link-cloak'
import { resolvePostAffiliateLink } from '@/lib/ig-dm'
import { postProductAsin } from '@/lib/post-product-link'
import { blogShareUrl, ensureAffiliateShareLink } from '@/lib/blog-share-url'
import { amazonDestination } from '@/lib/post-destination'
import { normalizeAsinInput } from '@/lib/asin'
import { parseLinkPrefs, composeCaption, effectiveDisclosure, youtubeWatchUrl, isAmazonLink, type ContentLink } from '@/lib/social-link-mode'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { landsOnAmazon } from '@/lib/amazon-destination'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const DEFAULT_DISCLAIMER = 'This post may contain affiliate links. I may earn a commission at no extra cost to you.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReelLinkSource = 'blog-post' | 'enhance-product' | 'video-asin'

export type ReelCaption = {
  caption: string
  productLink: string | null
  productSource: ReelLinkSource | null
  /** Set when the link went out plain instead of in the creator's style. */
  linkNote: string | null
  contentLink: string | null
}

/** "Link in bio" is Instagram's phrasing. On Facebook the link is right there. */
export function facebookWriteUp(text: string): string {
  return (text || '')
    .replace(/\b(l)ink\s+in\s+(?:my\s+)?bio\b/gi, (_m, l: string) => `${l === 'L' ? 'L' : 'l'}ink above`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Everything a clip's description can carry, resolved once per platform:
 *  the product link (in the creator's link style, minted for that platform),
 *  the full review, the link hub, and the disclosure. */
export type ClipLinks = {
  productLink: string | null
  productSource: ReelLinkSource | null
  linkNote: string | null
  /** The product link lands on Amazon, however it is wrapped. */
  amazon: boolean
  blogUrl: string | null
  videoUrl: string | null
  /** The creator's Linktree or link hub from Brand Profile. */
  linkHub: string | null
  disclosure: string
  /** The source video's title, for writing a title or tags. */
  videoTitle: string | null
}

export async function resolveClipLinks(sb: Sb, userId: string, input: {
  sourceVideoId?: string | null
  product?: string | null
  productName?: string | null
  /** Where the link will be posted, for the link style and attribution. */
  channel?: 'facebook' | 'youtube' | 'tiktok' | 'instagram'
}): Promise<ClipLinks> {
  const channel = input.channel ?? 'facebook'
  const [{ data: intRow }, { data: brand }] = await Promise.all([
    sb.from('integrations').select('amazon_associates_tag,social_link_modes,geniuslink_api_key,geniuslink_api_secret').eq('user_id', userId).maybeSingle(),
    sb.from('brand_profiles').select('affiliate_disclaimer,linktree_url').eq('user_id', userId).maybeSingle(),
  ])
  const integration = decryptIntegrationRow(intRow)
  const tag = (integration?.amazon_associates_tag as string | null) ?? null

  // ── the source video and its blog post ────────────────────────────────────
  const srcId = String(input.sourceVideoId || '').trim()
  const { data: video } = UUID.test(srcId)
    ? await sb.from('youtube_videos').select('id,youtube_video_id,title,asin').eq('id', srcId).eq('user_id', userId).maybeSingle()
    : { data: null }
  const { data: posts } = video
    ? await sb.from('blog_posts')
      .select('id,title,content,wordpress_url,wordpress_site_id,geniuslink_code,geniuslink_blog_url')
      .eq('user_id', userId).eq('video_id', video.id).eq('status', 'published')
      .not('wordpress_url', 'is', null).order('created_at', { ascending: false }).limit(1)
    : { data: null }
  const post = (posts ?? [])[0] ?? null

  const cfg = await getLinkStyle(sb, userId)
  let productLink: string | null = null
  let productSource: ReelLinkSource | null = null
  let linkNote: string | null = null
  let amazon = false
  const title = (video?.title as string) || input.productName || ''

  // 1. The blog post's own product link.
  if (post) {
    const link = resolvePostAffiliateLink(post, { linkStyle: cfg.style })
    if (link) {
      amazon = isAmazonLink(link) || !!postProductAsin(post)
      productLink = await ensureAffiliateShareLink(sb, {
        postId: post.id, link, title: post.title ?? title, userId,
        apiKey: integration?.geniuslink_api_key ?? null, apiSecret: integration?.geniuslink_api_secret ?? null,
        siteId: post.wordpress_site_id ?? null, siteUrl: post.wordpress_url ?? null,
        source: channel,
      }).catch(() => link)
      productSource = 'blog-post'
      if (!amazon && productLink) amazon = await landsOnAmazon(userId, productLink)
    }
  }

  // 2 and 3. The product from Enhance, then the video's own ASIN.
  if (!productLink) {
    const typed = String(input.product || '').trim()
    const typedAsin = typed ? normalizeAsinInput(typed) : null
    const videoAsin = video?.asin ? normalizeAsinInput(String(video.asin)) : null
    const typedUrl = !typedAsin && /^https:\/\//i.test(typed) ? typed : null
    const asin = typedAsin || (typedUrl ? null : videoAsin)
    const dest = asin ? amazonDestination(asin, tag) : typedUrl
    if (dest) {
      const r = await resolveCloakedLinkDetailed({ supabase: sb, userId, destination: dest, asin, channel, source: channel, label: title, config: cfg })
      productLink = r.url || dest
      linkNote = cloakFallbackNote(r)
      amazon = !!asin || isAmazonLink(dest) || (typedUrl ? await landsOnAmazon(userId, typedUrl) : false)
      productSource = (typedAsin || typedUrl) ? 'enhance-product' : 'video-asin'
    }
  }

  const blogUrl = post ? (blogShareUrl(post) || post.wordpress_url) : null
  const videoUrl = youtubeWatchUrl(video?.youtube_video_id)
  const disclosure = effectiveDisclosure(((brand?.affiliate_disclaimer as string) || DEFAULT_DISCLAIMER), productLink, !!tag && amazon)
  const linkHub = String((brand?.linktree_url as string) || '').trim() || null
  return { productLink, productSource, linkNote, amazon, blogUrl, videoUrl, linkHub, disclosure, videoTitle: (video?.title as string) || null }
}

export async function buildReelCaption(sb: Sb, userId: string, input: {
  writeUp: string
  sourceVideoId?: string | null
  product?: string | null
  productName?: string | null
}): Promise<ReelCaption> {
  const { data: intRow } = await sb.from('integrations').select('social_link_modes').eq('user_id', userId).maybeSingle()
  const links = await resolveClipLinks(sb, userId, { ...input, channel: 'facebook' })
  const { productLink, productSource, linkNote, amazon, blogUrl, videoUrl, disclosure } = links

  // ── the full review ───────────────────────────────────────────────────────
  // The creator's Facebook setting picks blog or video; unset, a Reel points
  // at the long video it was cut from, which is what a viewer who liked the
  // clip wants next.
  const stored = parseLinkPrefs(decryptIntegrationRow(intRow)?.social_link_modes).facebook
  const content: ContentLink = stored?.content ?? 'video'

  const caption = composeCaption({
    product: true, content, writeUp: facebookWriteUp(input.writeUp),
    blogUrl, videoUrl, affiliateLink: productLink, disclosure,
    blogLabel: 'Read the full review', amazonDestination: amazon,
  })
  const contentLink = content === 'none' ? null : (content === 'video' ? (videoUrl || blogUrl) : (blogUrl || null))
  return { caption, productLink, productSource, linkNote, contentLink }
}
