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

import { asinPathRegex, ASIN_PATH_SEGMENTS } from '@/lib/asin'
/** An Amazon product URL anywhere in the post body. Anchored on /dp/ or
 *  /gp/product/ followed by a real ten-character id, so a link to a category
 *  page or a search result is not mistaken for the product. */
const AMAZON_IN_BODY = new RegExp(
  `https?:\\/\\/(?:[a-z0-9-]+\\.)*amazon\\.[a-z.]+\\/(?:[^\\s"'<>]*?\\/)?(?:${ASIN_PATH_SEGMENTS})\\/[A-Z0-9]{10}[^\\s"'<>]*`,
  'gi',
)
const GENIUS_IN_BODY = /https?:\/\/geni\.us\/[A-Za-z0-9]+/i
/** A PASSPORT link in the post body: the branded short domain, or the app-origin
 *  /go/<code> fallback. Matched with a regex rather than by importing
 *  lib/passport-links, which reaches for Supabase and Node DNS and would drag
 *  both into every client bundle that imports this file. The two shapes are
 *  pinned by scripts/test-post-link.ts against passportLinkUrl(). */
const PASSPORT_IN_BODY = /https?:\/\/(?:[a-z0-9-]+\.)*mvpl\.ink\/[A-Za-z0-9_-]+|https?:\/\/(?:[a-z0-9-]+\.)*mvpaffiliate\.io\/go\/[A-Za-z0-9_-]+/i
const ASIN_IN_BODY = asinPathRegex('i')

export interface PostLinkFields {
  geniuslink_code?: string | null
  content?: string | null
}

/** The creator's chosen link style, when the caller knows it. Only used to
 *  decide whether the STORED geni.us code is an acceptable last resort. */
export type PostLinkStyle = 'passport' | 'geniuslink' | 'bitly' | 'direct'

/**
 * The post's product destination, for the creator's own link style to cloak.
 *
 * Amazon URL in the body, then a Passport link in the body, then a geni.us in
 * the body, then the stored code. Every one of them is a destination, never a
 * decision: the cloaker reads the creator's style and has the final say.
 *
 * THE PASSPORT STEP IS WHY THIS WAS REWRITTEN A SECOND TIME.
 *
 * The first version put the stored geniuslink_code first and unconditionally,
 * which posted geni.us links from a Passport creator's account for months. That
 * was fixed by demoting it to a last resort. It was not enough, and on 11
 * September an auto-pilot cascade posted geni.us to Facebook, Instagram and
 * Bluesky from an account that has been on Passport for weeks.
 *
 * The reason is that "last resort" was reached EVERY TIME for exactly the
 * creators the fix was for. A Passport creator's post body contains mvpl.ink
 * links and nothing else: no Amazon URL, no geni.us. Both body checks missed,
 * and the only branch left was a geniuslink_code written back when Geniuslink
 * was the style. The post's own live, correct link was sitting in the body being
 * ignored, and a months-old code won.
 *
 * So the body's Passport link is now read, and it outranks anything stored.
 *
 * `linkStyle` closes the remaining hole. A post with no product link at all in
 * its body still fell through to the stored code, and for anyone not on
 * Geniuslink that is never the right answer. Pass the creator's style and the
 * stored code is only used when they actually use Geniuslink. Omit it and the
 * old behaviour stands, so no caller changes meaning by accident.
 */
export function postProductDestination(
  post: PostLinkFields,
  opts?: { linkStyle?: PostLinkStyle },
): string | null {
  const html = post.content || ''
  const amazon = html.match(AMAZON_IN_BODY)
  if (amazon) return amazon[0]
  // The creator's own current cloaked link, already in the published post.
  // Nothing stored can be fresher than this.
  const passport = html.match(PASSPORT_IN_BODY)
  if (passport) return passport[0]
  const genius = html.match(GENIUS_IN_BODY)
  if (genius) return genius[0]
  // A stored code is the only candidate that is not evidence from the post
  // itself, so it is the only one a style can veto.
  const storedCodeAllowed = opts?.linkStyle === undefined || opts.linkStyle === 'geniuslink'
  if (post.geniuslink_code && storedCodeAllowed) return `https://geni.us/${post.geniuslink_code}`
  return null
}

/** The ASIN of the post's product, when the body carries an Amazon link. Lets
 *  the cloaker mint a Passport link with no network call at all. */
export function postProductAsin(post: { content?: string | null }): string | null {
  const m = (post.content || '').match(ASIN_IN_BODY)
  return m ? m[1].toUpperCase() : null
}
