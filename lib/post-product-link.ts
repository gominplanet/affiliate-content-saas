// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which link a published post points at, before any cloaking.
//
// This is the function that put geni.us links on a Passport creator's Facebook
// page for months after they switched. It answered with
// `https://geni.us/${geniuslink_code}` first and unconditionally, so a code
// stored on the post back when Geniuslink was connected outranked the creator's
// actual, current setting on every surface that shares a post: Facebook,
// LinkedIn, Bluesky, the scheduler, and the comment-to-DM replies, which did not
// cloak at all and sent it verbatim.
//
// The rule now is that this returns a DESTINATION and never a decision. Cloaking
// is one job, it belongs to lib/link-cloak, and it reads the creator's chosen
// style. Nothing here is allowed to pick a link provider on their behalf.
//
// The order matters beyond the obvious. An Amazon link from the body wins
// because it is the only candidate an ASIN can be read out of with no network
// call, and Passport needs that ASIN to mint a geo-routing link. The old code
// path had to unwrap a geni.us over the network to recover it, and an unwrap
// that timed out left the geni.us in place. Preferring the Amazon URL removes
// the failure instead of retrying it.
//
// Pure and dependency-free so the ordering is tested rather than trusted.

/** An Amazon product URL anywhere in the post body. Anchored on /dp/ or
 *  /gp/product/ followed by a real ten-character id, so a link to a category
 *  page or a search result is not mistaken for the product. */
const AMAZON_IN_BODY = /https?:\/\/(?:www\.)?amazon\.[a-z.]+\/(?:[^\s"'<>]*?\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}[^\s"'<>]*/i
const GENIUS_IN_BODY = /https?:\/\/geni\.us\/[A-Za-z0-9]+/i
const ASIN_IN_BODY = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i

export interface PostLinkFields {
  geniuslink_code?: string | null
  content?: string | null
}

/**
 * The post's product destination, for the creator's own link style to cloak.
 *
 * Amazon URL in the body, then a geni.us in the body, then the stored code as a
 * last resort for a post whose body has no product URL left in it. Even that
 * last one is a destination like any other and still goes through the cloaker.
 */
export function postProductDestination(post: PostLinkFields): string | null {
  const html = post.content || ''
  const amazon = html.match(AMAZON_IN_BODY)
  if (amazon) return amazon[0]
  const genius = html.match(GENIUS_IN_BODY)
  if (genius) return genius[0]
  if (post.geniuslink_code) return `https://geni.us/${post.geniuslink_code}`
  return null
}

/** The ASIN of the post's product, when the body carries an Amazon link. Lets
 *  the cloaker mint a Passport link with no network call at all. */
export function postProductAsin(post: { content?: string | null }): string | null {
  const m = (post.content || '').match(ASIN_IN_BODY)
  return m ? m[1].toUpperCase() : null
}
