// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// The URL to SHARE for a blog post on social. Prefers the cached geni.us short
// link (created at generation time when the user enabled wrap_blog_geniuslink),
// otherwise the raw WordPress URL. Use this ONLY for the shareable link in a
// caption / link-card — never for og-image scraping or the WP edit link, which
// must hit the real WordPress URL.

import { createGeniuslinkService } from '@/services/geniuslink'
import { shortenBitly } from '@/lib/bitly'

export type BlogSocialLinkMode = 'direct' | 'geniuslink' | 'bitly'

/** Sync pick: cached short link → raw WP URL → null. Never throws. */
export function blogShareUrl(post: { geniuslink_blog_url?: string | null; wordpress_url?: string | null }): string | null {
  return post.geniuslink_blog_url || post.wordpress_url || null
}

/**
 * "If a user has a Geniuslink, MVP always uses it."
 *
 * A post generated during a brief Geniuslink hiccup ships with NO geniuslink_code,
 * so its stored affiliate link is the raw Amazon URL (…/dp/ASIN?tag=…). When that
 * link is about to be SHARED and the creator has Geniuslink connected, build a
 * Geniuslink for it right now, persist the code back on the post so every later
 * share reuses it, and return the geni.us URL.
 *
 * Best-effort: returns the ORIGINAL link on any failure (a post never fails to go
 * out just because Geniuslink is briefly down — the raw tagged link still earns).
 * No-op when the link is already a geni.us link, isn't an Amazon link, or the
 * creator has no Geniuslink creds.
 */
export async function ensureAffiliateGeniuslink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { postId: string; link: string | null; title: string; apiKey: string | null; apiSecret: string | null; groupId?: number | null },
): Promise<string | null> {
  const { postId, link, title, apiKey, apiSecret, groupId } = opts
  if (!link || !apiKey || !apiSecret) return link
  if (/geni\.us/i.test(link)) return link                 // already a Geniuslink
  if (!/amazon\.[a-z.]+/i.test(link)) return link          // not Amazon — leave it
  try {
    const genius = createGeniuslinkService(apiKey, apiSecret)
    const { url: gl, code } = await genius.createLinkWithCode(link, (title || 'Product').slice(0, 120), groupId != null ? { groupId } : undefined)
    if (gl && /geni\.us/i.test(gl)) {
      if (code) {
        try { await supabase.from('blog_posts').update({ geniuslink_code: code }).eq('id', postId) } catch { /* non-fatal */ }
      }
      return gl
    }
  } catch { /* fall back to the raw tagged link */ }
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
