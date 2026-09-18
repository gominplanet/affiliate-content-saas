// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MANY LINKS ON THIS SITE ARE ACTUALLY IN THE STYLE THE CREATOR CHOSE?
//
// The Fix Affiliate Links preview answered a different question and worded the
// answer as if it were this one. A creator saw:
//
//   "Style: Geniuslink · 1 of 4 would be re-pointed · 3 already correct"
//
// and a page of his own carrying six raw Amazon links and zero Geniuslinks.
// Both statements were produced by MVP on the same afternoon.
//
// The preview examines ONE link per post: the product link from the video row,
// or the best-ranked affiliate href in the body. It classifies that single link
// and then counts POSTS. "3 already correct" means "on three posts, the one link
// I looked at was in the right style". A post with one good link and five raw
// ones lands in the correct column. A post whose video row is missing never gets
// classified at all and lands in a skip bucket nobody reads.
//
// The file's own comment records this class of bug being fixed once already:
//
//   "'No broken links found' was true for a creator whose every link was the
//    wrong style, and it read as all-clear."
//
// That fix worked at the post level. This is the same failure one level down.
//
// So this counts LINKS. Every affiliate href in the stored body of every post,
// classified by the same styleOfUrl every generator uses, reported as links. A
// creator can check the number against their own page by reading it, which is
// the property the old number lacked.

import { styleOfUrl, type LinkStyle } from '@/lib/link-style'

/** Retailer or shortener hrefs worth looking at at all. Deliberately wider than
 *  the set styleOfUrl can name, so links with no readable style are COUNTED AND
 *  SHOWN rather than dropped — see `other` below. */
const RETAILER_HREF = /\b(?:amazon\.[a-z.]+|amzn\.to|a\.co|geni\.us|gnz\.|mvpl\.ink|bit\.ly|walmart\.com|target\.com|bestbuy\.com)\b/i

export interface LinkCensus {
  /** Links that HAVE a style: the ones on/off-style is a fair question about. */
  total: number
  /** Links already in the creator's chosen style. */
  onStyle: number
  /** Links in some other style. These are the work. */
  offStyle: number
  /**
   * Retailer links with no style to read: an Amazon search or storefront URL, a
   * Walmart or Target link, anything Geniuslink and Passport do not wrap.
   *
   * Counted separately rather than dropped, and never folded into offStyle.
   * Calling them off-style would invent work on a Walmart post; dropping them
   * would let a page covered in Amazon search links report "all 2 links are
   * Geniuslink", which is the same kind of lie this file exists to end.
   */
  other: number
  /** Posts carrying at least one off-style link. */
  postsAffected: number
  /** Posts scanned. */
  posts: number
  /** The worst offenders, most off-style links first, for a readable list. */
  worst: Array<{ id: string; title: string; offStyle: number; total: number }>
}

export interface CensusPost {
  id: string
  title: string | null
  /** The stored post body. */
  content: string | null
}

/**
 * Every retailer href in a body, in document order.
 *
 * NOT deduplicated by URL. The same link appearing four times is four links a
 * reader can click and four links that are wrong, and the creator comparing this
 * number against their own page is counting what they can see.
 */
export function retailerHrefs(html: string | null | undefined): string[] {
  const s = String(html ?? '')
  if (!s) return []
  const out: string[] = []
  for (const m of s.matchAll(/href="([^"]*)"/gi)) {
    // WordPress writes `&#038;` where the editor wrote `&`. styleOfUrl parses
    // with `new URL`, which does not care, but the entity has bitten a URL
    // comparison in this codebase before, so it is normalised once here.
    const url = m[1].replace(/&(?:amp|#0*38);/gi, '&')
    if (RETAILER_HREF.test(url)) out.push(url)
  }
  return out
}

/**
 * Count the links, not the posts.
 */
export function buildLinkCensus(posts: CensusPost[], chosenStyle: LinkStyle): LinkCensus {
  let total = 0
  let onStyle = 0
  let other = 0
  let postsAffected = 0
  const worst: LinkCensus['worst'] = []

  for (const p of posts) {
    const hrefs = retailerHrefs(p.content)
    if (!hrefs.length) continue
    let off = 0
    let styled = 0
    for (const h of hrefs) {
      const style = styleOfUrl(h)
      if (style === null) { other++; continue }
      total++
      styled++
      if (style === chosenStyle) onStyle++
      else off++
    }
    if (off > 0) {
      postsAffected++
      worst.push({
        id: p.id,
        title: String(p.title ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 120) || '(untitled)',
        offStyle: off,
        total: styled,
      })
    }
  }

  worst.sort((a, b) => b.offStyle - a.offStyle || b.total - a.total)

  return {
    total,
    onStyle,
    offStyle: total - onStyle,
    other,
    postsAffected,
    posts: posts.length,
    worst: worst.slice(0, 25),
  }
}

/**
 * The sentence a creator reads.
 *
 * Links first and posts second, because links are the thing on the page and the
 * post count is what made the old wording misleading. Returns null when there is
 * genuinely nothing to say, so a caller can write `if (note) show(note)`.
 */
export function describeCensus(c: LinkCensus, styleLabel: string): string | null {
  if (c.total === 0 && c.other === 0) return null
  const tail = c.other > 0
    ? ` ${c.other.toLocaleString()} further retailer ${c.other === 1 ? 'link is' : 'links are'} search, storefront or non-Amazon ${c.other === 1 ? 'and carries' : 'and carry'} no link style.`
    : ''
  const posts = `${c.posts.toLocaleString()} ${c.posts === 1 ? 'post' : 'posts'}`
  if (c.total === 0) {
    return `No ${styleLabel} links, and no links of any other style, across your ${posts}.${tail}`
  }
  if (c.offStyle === 0) {
    return c.total === 1
      ? `The one affiliate link across your ${posts} is a ${styleLabel} link.${tail}`
      : `All ${c.total.toLocaleString()} affiliate links across your ${posts} are ${styleLabel} links.${tail}`
  }
  return `${c.offStyle.toLocaleString()} of ${c.total.toLocaleString()} affiliate links are NOT ${styleLabel}, across ${c.postsAffected.toLocaleString()} ${c.postsAffected === 1 ? 'post' : 'posts'}. Counted link by link, not one link per post.${tail}`
}
