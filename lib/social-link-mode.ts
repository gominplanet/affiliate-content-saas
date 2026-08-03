// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-platform link preferences for social fan-out (Facebook / LinkedIn /
// Bluesky — the platforms with a clickable caption link). TWO independent axes:
//
//   product : boolean          — include the affiliate "buy it" link?
//   content : blog | video | none — the "learn more" link: your blog post, your
//                                    YouTube review video, or nothing.
//
// So a caption can be "affiliate + video, no blog", "blog only", "affiliate
// only", etc. Retailer wording is neutral unless we can confirm Amazon, and the
// disclosure adds the Amazon-Associate line only when an Amazon link is in play.

export const LINK_MODE_PLATFORMS = ['facebook', 'linkedin', 'bluesky'] as const
export type LinkModePlatform = typeof LINK_MODE_PLATFORMS[number]

export type ContentLink = 'blog' | 'video' | 'none'
export interface PlatformLinkPref { product: boolean; content: ContentLink }
export type SocialLinkPrefs = Partial<Record<LinkModePlatform, PlatformLinkPref>>

const CONTENT_VALUES: ContentLink[] = ['blog', 'video', 'none']

// Back-compat: the column previously stored a string enum per platform.
function migrateOld(v: string): PlatformLinkPref | null {
  switch (v) {
    case 'blog': return { product: false, content: 'blog' }
    case 'affiliate': return { product: true, content: 'none' }
    case 'both': return { product: true, content: 'blog' }
    default: return null
  }
}

/** Parse the stored jsonb (old string enum OR new object) into clean prefs. */
export function parseLinkPrefs(raw: unknown): SocialLinkPrefs {
  const out: SocialLinkPrefs = {}
  if (raw && typeof raw === 'object') {
    for (const p of LINK_MODE_PLATFORMS) {
      const v = (raw as Record<string, unknown>)[p]
      if (typeof v === 'string') { const m = migrateOld(v); if (m) out[p] = m }
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        const content = CONTENT_VALUES.includes(o.content as ContentLink) ? (o.content as ContentLink) : 'blog'
        out[p] = { product: !!o.product, content }
      }
    }
  }
  return out
}

/** The pref for a platform, defaulting to blog-only (the pre-existing behavior). */
export function linkPrefFor(prefs: SocialLinkPrefs, platform: LinkModePlatform): PlatformLinkPref {
  return prefs[platform] ?? { product: false, content: 'blog' }
}

/** A YouTube watch URL from a video id (null when there's no source video). */
export function youtubeWatchUrl(videoId: string | null | undefined): string | null {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
}

/** Is this affiliate link an Amazon destination we can be sure about? geni.us
 *  and other routers are NOT counted (they route dynamically). */
export function isAmazonLink(url: string | null | undefined): boolean {
  if (!url) return false
  return /amazon\.[a-z.]+|amzn\.to/i.test(url)
}

const AMZ_ASSOCIATE_LINE = 'As an Amazon Associate I earn from qualifying purchases.'

/** The disclosure to actually post: the brand's own line, plus the Amazon
 *  Associate line when an Amazon link (or the creator's Amazon tag) is present
 *  and it isn't already covered. Never names a retailer we can't confirm. */
export function effectiveDisclosure(base: string, affiliateLink: string | null, hasAmazonTag: boolean): string {
  const b = (base || '').trim()
  const amazon = isAmazonLink(affiliateLink) || hasAmazonTag
  if (amazon && !/amazon associate/i.test(b)) return b ? `${b} ${AMZ_ASSOCIATE_LINE}` : AMZ_ASSOCIATE_LINE
  return b
}

// Neutral unless the link is confirmably Amazon.
function productCtaLine(link: string): string {
  return isAmazonLink(link) ? `🛒 Grab it on Amazon 👉 ${link}` : `🛒 Get it here 👉 ${link}`
}
function blogCtaLine(url: string, label: string): string { return `🔗 ${label}: ${url}` }
function videoCtaLine(url: string): string { return `🎬 Want to see it in action? Watch the full review 👉 ${url}` }

/** The content CTA line, with a sensible fallback: video→blog when there's no
 *  source video (e.g. a "from a link" post). Empty when there's nothing to link. */
function contentCtaLine(content: ContentLink, blogUrl: string | null, videoUrl: string | null, blogLabel: string): string {
  if (content === 'none') return ''
  if (content === 'video') {
    if (videoUrl) return videoCtaLine(videoUrl)
    if (blogUrl) return blogCtaLine(blogUrl, blogLabel)
    return ''
  }
  return blogUrl ? blogCtaLine(blogUrl, blogLabel) : ''
}

/** The single URL a link-CARD should point at (FB link fallback, LinkedIn
 *  article card, Bluesky embed): the product when product+link, else the content
 *  link (video preferred, then blog), else whatever we have. */
export function primaryCardUrl(pref: PlatformLinkPref, affiliateLink: string | null, blogUrl: string | null, videoUrl: string | null): string | null {
  if (pref.product && affiliateLink) return affiliateLink
  if (pref.content === 'video' && videoUrl) return videoUrl
  if (pref.content !== 'none' && blogUrl) return blogUrl
  return blogUrl || affiliateLink || null
}

/**
 * Compose the caption for a roomy text platform (Facebook, LinkedIn).
 *   product on  → affiliate CTA + disclosure, then the write-up, then the
 *                 content link (blog or video).
 *   product off → content link on top, the write-up, disclosure at the end.
 * `disclosure` is the already-resolved line (see effectiveDisclosure).
 */
export function composeCaption(opts: {
  product: boolean
  content: ContentLink
  writeUp: string
  blogUrl: string | null
  videoUrl: string | null
  affiliateLink: string | null
  disclosure: string
  blogLabel?: string
}): string {
  const blogLabel = opts.blogLabel ?? 'Read the full post'
  const writeUp = opts.writeUp.trim()
  const disc = opts.disclosure.trim()
  const useProduct = opts.product && !!opts.affiliateLink
  const contentLine = contentCtaLine(opts.content, opts.blogUrl, opts.videoUrl, blogLabel)

  if (useProduct) {
    const head = `${productCtaLine(opts.affiliateLink as string)}${disc ? `\n${disc}` : ''}`
    return [head, writeUp, contentLine].filter(Boolean).join('\n\n').trim()
  }
  return [contentLine, writeUp, disc].filter(Boolean).join('\n\n').trim()
}
