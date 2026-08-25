// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// The URL to SHARE for a blog post on social. Prefers the cached geni.us short
// link (created at generation time when the user enabled wrap_blog_geniuslink),
// otherwise the raw WordPress URL. Use this ONLY for the shareable link in a
// caption / link-card — never for og-image scraping or the WP edit link, which
// must hit the real WordPress URL.

import { createGeniuslinkService } from '@/services/geniuslink'
import { shortenBitly } from '@/lib/bitly'
import { getLinkStyle } from '@/lib/link-cloak'
import { resolveGeniuslinkGroupId } from '@/lib/geniuslink-group'

export type BlogSocialLinkMode = 'direct' | 'geniuslink' | 'bitly'

/** Sync pick: cached short link → raw WP URL → null. Never throws. */
export function blogShareUrl(post: { geniuslink_blog_url?: string | null; wordpress_url?: string | null }): string | null {
  return post.geniuslink_blog_url || post.wordpress_url || null
}

/**
 * Cloak the post's affiliate PRODUCT link (the "buy it now" CTA) at SHARE time,
 * per the creator's ONE chosen Link style — the same style every other surface
 * uses:
 *   geniuslink → build a geni.us link (correct per-site group), persist the code
 *                on the post so later shares reuse it, and return the geni.us URL.
 *   bitly      → shorten the link with the creator's Bitly token.
 *   direct/passport → return the link unchanged (a passport product link is
 *                already minted upstream; a raw tagged link still earns).
 *
 * Reads the style itself via getLinkStyle(userId), so a creator who has Geniuslink
 * keys but picked another style is never surprise-wrapped. Best-effort: returns
 * the ORIGINAL link on any failure — a post never fails to go out over this. No-op
 * when the link is already a geni.us link.
 */
export async function ensureAffiliateShareLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    postId: string
    link: string | null
    title: string
    userId: string
    apiKey: string | null
    apiSecret: string | null
    siteId?: string | null
    siteUrl?: string | null
  },
): Promise<string | null> {
  const { postId, link, title, userId, apiKey, apiSecret, siteId, siteUrl } = opts
  if (!link) return link
  if (/geni\.us/i.test(link)) return link                  // already a Geniuslink

  const cfg = await getLinkStyle(supabase, userId)
  if (cfg.style === 'geniuslink' && apiKey && apiSecret && /amazon\.[a-z.]+/i.test(link)) {
    try {
      const groupId = await resolveGeniuslinkGroupId({ supabase, siteId, siteUrl, apiKey, apiSecret }).catch(() => null)
      const genius = createGeniuslinkService(apiKey, apiSecret)
      const { url: gl, code } = await genius.createLinkWithCode(link, (title || 'Product').slice(0, 120), groupId != null ? { groupId } : undefined)
      if (gl && /geni\.us/i.test(gl)) {
        if (code) {
          try { await supabase.from('blog_posts').update({ geniuslink_code: code }).eq('id', postId) } catch { /* non-fatal */ }
        }
        return gl
      }
    } catch { /* fall back to the raw tagged link */ }
  } else if (cfg.style === 'bitly' && cfg.bitlyToken) {
    try {
      const short = await shortenBitly(cfg.bitlyToken, link)
      if (short) return short
    } catch { /* fall back to the raw tagged link */ }
  }
  return link
}

/**
 * At generation time: shorten the post's blog URL for social sharing according
 * to the creator's chosen link mode, and cache it on the row (in
 * blog_posts.geniuslink_blog_url, which blogShareUrl reads — the column holds
 * "the cached social short link", whatever provider made it).
 *
 *   'direct'      → no short link; social shares the plain WordPress URL
 *   'geniuslink'  → branded geni.us link (tracked, costs per click)
 *   'bitly'       → free Bitly short link (needs the creator's Bitly token)
 *
 * Best-effort — returns the short link, or null on any failure / 'direct'
 * (caller keeps the plain WordPress URL). A share never breaks over this.
 */
export async function maybeCreateBlogShortlink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    postId: string
    blogUrl: string | null | undefined
    title: string
    mode: BlogSocialLinkMode
    geniuslinkKey?: string | null
    geniuslinkSecret?: string | null
    bitlyToken?: string | null
  },
): Promise<string | null> {
  const { postId, blogUrl, title, mode } = opts
  if (!blogUrl || mode === 'direct') return null
  let short: string | null = null
  try {
    if (mode === 'geniuslink' && opts.geniuslinkKey && opts.geniuslinkSecret) {
      const genius = createGeniuslinkService(opts.geniuslinkKey, opts.geniuslinkSecret)
      short = await genius.createLink(blogUrl, (title || 'Blog post').slice(0, 120))
    } else if (mode === 'bitly' && opts.bitlyToken) {
      short = await shortenBitly(opts.bitlyToken, blogUrl)
    }
  } catch { /* keep the plain WordPress URL */ }
  if (short) {
    try { await supabase.from('blog_posts').update({ geniuslink_blog_url: short }).eq('id', postId) } catch { /* non-fatal */ }
    return short
  }
  return null
}
