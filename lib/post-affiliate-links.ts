// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY LINK A READER CAN CLICK, NOT JUST THE ONE THE POST IS ABOUT.
//
// A creator ran Fix Affiliate Links and reported that half his links stayed
// plain. His post holds ten affiliate links. Four of them are the product, and
// the other six are Amazon SEARCH links: the inline product-name links, the
// "Shop everything in this video" link, and the sticky mobile button.
//
// The fixer never saw them, and for a reason that was right at the time. The
// file it lives in asks ONE question to decide what a post is about:
//
//   "Search and storefront URLs are dropped entirely: they are navigation, not
//    a buy link, and nothing here should reason about them."
//
// That is correct for THAT question. A post whose first link is a search for
// "MacBook Pro" is not a post about a MacBook Pro, and an earlier bug came from
// trying to pull a product id out of one.
//
// It is the wrong answer to a DIFFERENT question, which is "which links should
// carry the style the creator chose". A search link earns. It is tagged, a
// reader clicks it, and a commission follows. Dropping it from the product
// reasoning and dropping it from the conversion were the same line of code, and
// only one of them was intended.
//
// So this module answers only the second question, and leaves the first alone.
//
// THE BAR FOR "THIS IS AN AFFILIATE LINK": it carries a tag. An Amazon URL with
// no `tag=` is a help page or a category browse, and cloaking it would create a
// tracked link for something nobody earns on and burn a Geniuslink doing it.
import { hrefVariants, sameUrl } from '@/lib/html-url-swap'
import { isAmazonProductUrl } from '@/lib/asin'
import type { LinkStyle } from '@/lib/link-style'

export type LinkKind = 'product' | 'search' | 'storefront' | 'cloaked'

export interface ConvertibleLink {
  /** The href exactly as it appears, in its first-seen spelling. */
  url: string
  /** How many times it appears, counting every HTML encoding. */
  count: number
  kind: LinkKind
  /** The style it is in today. */
  style: LinkStyle | null
}

const CLOAKED = /(?:geni\.us|\bgnz\.)/i
const AMAZON_SHORT = /(?:amzn\.to|a\.co)\//i
const PASSPORT_ISH = /mvpl\.ink/i
const BITLY = /\bbit\.ly\//i

/**
 * What style is this URL in?
 *
 * Deliberately NOT lib/link-style's styleOfUrl, which answers `null` for an
 * Amazon search URL. That is right for its callers, which ask "can I read a
 * product out of this". Here a tagged search link is a direct affiliate link,
 * because that is what it is: it earns.
 */
export function currentStyleOf(url: string): LinkStyle | null {
  const s = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return null
  if (CLOAKED.test(s)) return 'geniuslink'
  if (PASSPORT_ISH.test(s)) return 'passport'
  if (BITLY.test(s)) return 'bitly'
  // Amazon's own shorteners carry the tag inside them and are not a cloaker the
  // creator chose, so they read as direct.
  if (AMAZON_SHORT.test(s)) return 'direct'
  if (/amazon\.[a-z.]+/i.test(s)) return hasAffiliateTag(s) ? 'direct' : null
  return null
}

/** Does this Amazon URL carry an Associates tag? The bar for "somebody earns
 *  on this click", and therefore for touching it at all. */
export function hasAffiliateTag(url: string): boolean {
  try {
    const u = new URL(url.replace(/&(?:amp|#0*38);/gi, '&'))
    const tag = u.searchParams.get('tag')
    return !!tag && tag.trim().length > 0
  } catch {
    return /[?&]tag=[^&\s]+/i.test(url)
  }
}

/** What sort of Amazon page is this? Only used to report and to order the work. */
export function kindOf(url: string): LinkKind {
  if (CLOAKED.test(url) || PASSPORT_ISH.test(url) || BITLY.test(url) || AMAZON_SHORT.test(url)) return 'cloaked'
  if (isAmazonProductUrl(url)) return 'product'
  if (/\/s\?|\/s\/|[?&]k=|\bfield-keywords=/i.test(url)) return 'search'
  return 'storefront'
}

/**
 * Every link in this post that should be converted to `chosenStyle`, deduped by
 * destination.
 *
 * Deduped because minting one Geniuslink per OCCURRENCE would cost a creator
 * four links for one product that appears four times, and every one of them
 * would point at the same place. Entity-aware, because the same URL is spelled
 * `&` in one block and `&#038;` in another and counting those as two
 * destinations would do exactly that.
 *
 * Products first. If a cap is applied upstream, the buy link should be the one
 * that gets converted, not whichever search link happened to sort first.
 */
export function convertibleLinks(html: string, chosenStyle: LinkStyle): ConvertibleLink[] {
  const found: ConvertibleLink[] = []

  for (const m of String(html ?? '').matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)) {
    const url = m[1]
    const style = currentStyleOf(url)
    if (style === null) continue        // not an affiliate link at all
    if (style === chosenStyle) continue // already right

    const existing = found.find(f => sameUrl(f.url, url))
    if (existing) { existing.count++; continue }
    found.push({ url, count: 1, kind: kindOf(url), style })
  }

  const rank = (k: LinkKind) => (k === 'product' ? 0 : k === 'search' ? 1 : 2)
  return found.sort((a, b) => rank(a.kind) - rank(b.kind))
}

/**
 * How many NEW cloaked links converting this post would create.
 *
 * Surfaced before anything is minted, because it is the creator's quota being
 * spent. A roundup with nine products is nine links, and finding that out
 * afterwards is not a choice they were offered.
 */
export function mintCost(links: ConvertibleLink[]): number {
  return links.length
}

/** Occurrences, which is what actually changes on the page. Reported beside the
 *  mint cost so "3 links" and "10 places" are not confused for each other. */
export function occurrenceCount(links: ConvertibleLink[]): number {
  return links.reduce((n, l) => n + l.count, 0)
}

/** Re-export so callers doing the swap do not have to know two modules. */
export { hrefVariants }
