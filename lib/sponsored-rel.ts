// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every outbound affiliate link in a post carries rel="nofollow sponsored".
//
// WHY A SWEEP AND NOT JUST CAREFUL CONSTRUCTION. Every link MVP builds already
// carries it: the price strip, the buttons, the inline linker, the comparison
// tables, the digest. That is a claim about the code paths we know about, and
// the body of a post is assembled from several of them plus prose written by a
// model. "Every link we construct is tagged" and "every link in the published
// post is tagged" are different statements, and only the second one is what
// somebody means when they say the posts are compliant.
//
// So the finished HTML is swept once, at the end, and the sweep is what makes
// the second statement true regardless of which path produced a given anchor.
//
// GOOGLE ASKS FOR sponsored ON AFFILIATE LINKS. nofollow rides along because it
// is the older signal and costs nothing, and noopener because any target=_blank
// without it hands the opened page a handle on ours.

/** Hosts whose links are affiliate links for our purposes. */
const AFFILIATE_HOST = /(?:^|\.)(?:amazon\.[a-z.]+|amzn\.to|geni\.us|walmart\.com|shareasale\.com)$/i

/** Does this href point somewhere that earns. */
export function isAffiliateHref(href: string): boolean {
  try {
    const u = new URL(href.trim())
    if (!/^https?:$/.test(u.protocol)) return false
    if (AFFILIATE_HOST.test(u.hostname)) return true
    // A creator's own branded shortener (their Geniuslink domain) carries a
    // tag we cannot see from the hostname, so the query is checked too.
    return /(?:^|[?&])tag=/.test(u.search)
  } catch {
    return false
  }
}

const NEEDED = ['nofollow', 'sponsored', 'noopener']

/**
 * Add the missing rel tokens to every affiliate anchor in this HTML.
 *
 * WHAT IT DOES NOT DO. It never removes a token somebody already put there, it
 * never touches a link that is not an affiliate link, and it never rewrites the
 * href. A sweep that edits more than it was asked to is a sweep nobody will
 * trust near a published post.
 */
export function ensureSponsoredRel(html: string): string {
  if (!html) return html
  return html.replace(/<a\b([^>]*)>/gi, (whole, attrs: string) => {
    const href = (attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || attrs.match(/\bhref\s*=\s*'([^']*)'/i))?.[1]
    if (!href || !isAffiliateHref(href)) return whole

    const relMatch = attrs.match(/\brel\s*=\s*"([^"]*)"/i) || attrs.match(/\brel\s*=\s*'([^']*)'/i)
    const have = new Set((relMatch?.[1] || '').toLowerCase().split(/\s+/).filter(Boolean))
    for (const t of NEEDED) have.add(t)
    const rel = [...have].join(' ')

    const next = relMatch
      ? attrs.replace(/\brel\s*=\s*("[^"]*"|'[^']*')/i, `rel="${rel}"`)
      : `${attrs} rel="${rel}"`
    return `<a${next}>`
  })
}

/** How many affiliate anchors in this HTML are still missing a token, for a
 *  screen or a log that wants to report the fact rather than assume it. */
export function untaggedAffiliateLinks(html: string): number {
  let n = 0
  for (const m of (html || '').matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = m[1]
    const href = (attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || attrs.match(/\bhref\s*=\s*'([^']*)'/i))?.[1]
    if (!href || !isAffiliateHref(href)) continue
    const rel = (attrs.match(/\brel\s*=\s*"([^"]*)"/i) || attrs.match(/\brel\s*=\s*'([^']*)'/i))?.[1] || ''
    if (!/\bsponsored\b/i.test(rel)) n++
  }
  return n
}
