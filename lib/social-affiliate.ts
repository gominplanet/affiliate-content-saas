// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A post's affiliate link for a social post, resolved the one way every
// platform route should: the creator's link style decides which stored link
// counts (lib/link-cloak), whether it lands on Amazon is decided BEFORE it is
// cloaked (a geni.us or mvpl.ink cannot say), then it is wrapped per their
// style with this platform as the source. The steps the LinkedIn and Facebook
// routes already took, shared so X, Threads and Telegram can offer the same
// "affiliate link" choice (Link settings, 2026-11-23). Server only.

import { getLinkStyle } from '@/lib/link-cloak'
import { resolvePostAffiliateLink } from '@/lib/ig-dm'
import { postProductAsin } from '@/lib/post-product-link'
import { landsOnAmazon } from '@/lib/amazon-destination'
import { ensureAffiliateShareLink } from '@/lib/blog-share-url'
import { isAmazonLink } from '@/lib/social-link-mode'
import { rememberLinkDestination } from '@/lib/social-disclaimer'

export async function socialAffiliateLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: any
    userId: string
    source: string
    apiKey?: string | null
    apiSecret?: string | null
  },
): Promise<{ link: string | null; amazon: boolean }> {
  try {
    const style = (await getLinkStyle(db, opts.userId)).style
    let link = resolvePostAffiliateLink(opts.post, { linkStyle: style })
    if (!link) return { link: null, amazon: false }
    const amazon = isAmazonLink(link) || !!postProductAsin(opts.post) || await landsOnAmazon(opts.userId, link)
    link = await ensureAffiliateShareLink(db, {
      postId: opts.post?.id, link, title: opts.post?.title ?? '', userId: opts.userId,
      apiKey: opts.apiKey ?? null, apiSecret: opts.apiSecret ?? null,
      siteId: opts.post?.wordpress_site_id ?? null, siteUrl: opts.post?.wordpress_url ?? null,
      source: opts.source,
    })
    if (link && amazon) rememberLinkDestination(link, 'amazon')
    return { link, amazon }
  } catch {
    // No affiliate link beats a wrong one: the post goes out with its content link.
    return { link: null, amazon: false }
  }
}
