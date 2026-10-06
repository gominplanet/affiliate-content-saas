// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT GOES IN A CLIP'S DESCRIPTION, CHOSEN PER PLATFORM.
//
// Clip Factory used to post one caption everywhere: the hook and hashtags. A
// creator could not choose a product link on Facebook and a "link in bio" on
// TikTok, and a YouTube Short went out with no link and three tags. Now each
// platform's pill opens a panel with these choices, and the text is built here
// from them, so what the panel shows is exactly what posts.
//
// The defaults follow where a link can be clicked:
//   Facebook   links in the description are clickable: product link on.
//   YouTube    Shorts descriptions show links as plain text (YouTube stopped
//              making them clickable in 2023): product link on, said plainly,
//              plus the full review.
//   TikTok     captions are not clickable: "link in bio" on, product link off.
//   Instagram  the same as TikTok.
// The disclosure is always included: it is the law (FTC) and Amazon's rule, not
// a style choice, so the panel shows it without a switch.

import { productCtaLine } from '@/lib/social-link-mode'

export type ClipPlatform = 'tiktok' | 'instagram' | 'youtube' | 'facebook'

export type ClipInclude = {
  /** The product link, with the retailer named beside it. */
  productLink: boolean
  /** A "link in bio" line pointing at the creator's profile link. */
  bioCta: boolean
  /** The full review: the long video, or the blog post when there is none. */
  review: boolean
  hashtags: boolean
}

/** The most each platform takes in a description. Past it the post is refused
 *  or cut, and a cut lands on the disclosure, which is last. */
export const CLIP_TEXT_LIMIT: Record<ClipPlatform, number> = { facebook: 2000, tiktok: 2200, instagram: 2200, youtube: 4800 }

export const CLIP_PLATFORM_RULES: Record<ClipPlatform, { label: string; linksClickable: boolean; linkNote: string; defaults: ClipInclude; bioLine: string }> = {
  facebook: {
    label: 'Facebook Reel', linksClickable: true,
    // NOT "clickable", flatly: Facebook limits outside links on many Pages,
    // and a Reel description past that limit shows its link as plain text.
    linkNote: 'Facebook limits outside links on many Pages, so a link in a Reel description may not be tappable.',
    defaults: { productLink: true, bioCta: false, review: true, hashtags: true },
    bioLine: '🛒 The link is on my Page',
  },
  youtube: {
    label: 'YouTube Short', linksClickable: false,
    linkNote: 'YouTube shows links in a Short’s description as plain text, not clickable. Viewers can still copy them, and they are clickable on a regular video.',
    defaults: { productLink: true, bioCta: false, review: true, hashtags: true },
    bioLine: '🛒 Links are on my channel page',
  },
  tiktok: {
    label: 'TikTok', linksClickable: false,
    linkNote: 'TikTok captions are not clickable, so "link in bio" is what sends people to buy.',
    defaults: { productLink: false, bioCta: true, review: false, hashtags: true },
    bioLine: '🛒 Link in bio to shop it',
  },
  instagram: {
    label: 'Instagram', linksClickable: false,
    linkNote: 'Instagram captions are not clickable, so "link in bio" is what sends people to buy.',
    defaults: { productLink: false, bioCta: true, review: false, hashtags: true },
    bioLine: '🛒 Link in bio to shop it',
  },
}

/** Hashtags, each once, with a #. Pure. */
export function hashtagLine(tags: string[] | null | undefined): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags ?? []) {
    const t = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase()); out.push(`#${t}`)
  }
  return out.join(' ')
}

/** Take the hashtags out of a write-up, so they are placed once, by choice. */
export function stripHashtags(text: string): string {
  return String(text || '').replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The description, built from the choices. Pure. */
export function composeClipDescription(opts: {
  platform: ClipPlatform
  writeUp: string
  include: ClipInclude
  productLink: string | null
  amazon: boolean
  videoUrl: string | null
  blogUrl: string | null
  linkHub: string | null
  hashtags: string[]
  disclosure: string
}): string {
  const rules = CLIP_PLATFORM_RULES[opts.platform]
  const lines: string[] = []
  // On a Facebook Page the link is right there, so "link in bio" (Instagram's
  // phrasing) reads as "link above".
  const raw = stripHashtags(opts.writeUp)
  const writeUp = opts.platform === 'facebook'
    ? raw.replace(/\b(l)ink\s+in\s+(?:my\s+)?bio\b/gi, (_m, l: string) => `${l === 'L' ? 'L' : 'l'}ink above`)
    : raw
  if (writeUp) lines.push(writeUp)
  const links: string[] = []
  if (opts.include.productLink && opts.productLink) links.push(productCtaLine(opts.productLink, opts.amazon))
  if (opts.include.bioCta) links.push(opts.linkHub && rules.linksClickable ? `🔗 All my links: ${opts.linkHub}` : rules.bioLine)
  if (opts.include.review) {
    if (opts.videoUrl) links.push(`🎬 Watch the full review 👉 ${opts.videoUrl}`)
    else if (opts.blogUrl) links.push(`🔗 Read the full review: ${opts.blogUrl}`)
  }
  if (links.length) lines.push(links.join('\n'))
  if (opts.include.hashtags) { const h = hashtagLine(opts.hashtags); if (h) lines.push(h) }
  const d = String(opts.disclosure || '').trim()
  if (d) lines.push(d)
  return lines.join('\n\n').trim()
}

/** What each choice can actually add, so a switch that would add nothing says
 *  why instead of looking like it worked. Pure. */
export function unavailableReasons(k: { productLink: string | null; videoUrl: string | null; blogUrl: string | null }, hashtags: string[]): Partial<Record<keyof ClipInclude, string>> {
  const out: Partial<Record<keyof ClipInclude, string>> = {}
  if (!k.productLink) out.productLink = 'No product link found: add the product in Enhance, or type the link into the text.'
  if (!k.videoUrl && !k.blogUrl) out.review = 'MVP does not know which long video or post this clip came from.'
  if (!hashtagLine(hashtags)) out.hashtags = 'This clip has no hashtags.'
  return out
}
