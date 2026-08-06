// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// The URL to SHARE for a blog post on social. Prefers the cached geni.us short
// link (created at generation time when the user enabled wrap_blog_geniuslink),
// otherwise the raw WordPress URL. Use this ONLY for the shareable link in a
// caption / link-card — never for og-image scraping or the WP edit link, which
// must hit the real WordPress URL.

import { createGeniuslinkService } from '@/services/geniuslink'

/** Sync pick: cached short link → raw WP URL → null. Never throws. */
export function blogShareUrl(post: { geniuslink_blog_url?: string | null; wordpress_url?: string | null }): string | null {
  return post.geniuslink_blog_url || post.wordpress_url || null
}

/**
 * At generation time: if the creator enabled geni.us wrapping AND has geni.us
 * creds, create a short link for the post's blog URL and cache it on the row.
 * Best-effort — returns the short link, or null on any failure (caller keeps the
 * plain WordPress URL). Only creates when there isn't one already.
 */
export async function maybeCreateBlogGeniuslink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { postId: string; blogUrl: string | null | undefined; title: string; enabled: boolean; apiKey: string | null; apiSecret: string | null },
): Promise<string | null> {
  if (!opts.enabled || !opts.blogUrl || !opts.apiKey || !opts.apiSecret) return null
  try {
    const genius = createGeniuslinkService(opts.apiKey, opts.apiSecret)
    const url = await genius.createLink(opts.blogUrl, (opts.title || 'Blog post').slice(0, 120))
    if (url) {
      await supabase.from('blog_posts').update({ geniuslink_blog_url: url }).eq('id', opts.postId)
      return url
    }
  } catch { /* keep the plain WordPress URL */ }
  return null
}
