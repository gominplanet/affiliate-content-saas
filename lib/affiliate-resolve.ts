// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared affiliate-link resolution. Mirrors the blog-generation pipeline's
// product → affiliate URL logic in one place so the generator and the
// "Fix affiliate links" repair tool agree on what a correct link is.
//
// Why this exists: the loose ASIN matcher used to treat any 10-char word
// (e.g. "UNDERWATER" from a title) as an Amazon ASIN, producing dead
// amazon.com/dp/UNDERWATER affiliate links. extractAsin is now hardened
// (requires B0… or a digit), and the repair tool re-resolves every link.

import { firstProductUrl, resolveFinalUrl, asinFromAmazonUrl } from '@/lib/product-link'
import { extractAsin, isValidAsin } from '@/services/amazon'
import { discoverProductForVideo } from '@/lib/product-detect'
import { createGeniuslinkService } from '@/services/geniuslink'
import { appendAmazonSubtag } from '@/lib/geniuslink-group'

const GENIUSLINK = /(?:geni\.us|\bgnz\.)/i
const SHORTENERS = /(?:amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i

/** Follow a link to its TRUE destination, unwrapping affiliate-network
 *  redirectors (Skimlinks/VigLink/etc.) that carry the real URL in a query
 *  param. Used both to verify a Geniuslink and to unwrap a source link. */
export async function resolveTrueDestination(url: string): Promise<string> {
  const final = await resolveFinalUrl(url)
  try {
    const u = new URL(final)
    if (/(?:go\.redirectingat\.com|go\.skimresources\.com|redirect\.viglink\.com)$/i.test(u.hostname)) {
      const inner = u.searchParams.get('url') || u.searchParams.get('u')
      if (inner) return decodeURIComponent(inner)
    }
  } catch { /* not parseable — fall through */ }
  return final
}

/** Does `resolved` point at the same product we `intended`? For Amazon we
 *  accept any Amazon locale (geni.us localizes amazon.com → amazon.co.uk etc.);
 *  for a direct store link we require the same registrable host. */
export function pointsToIntendedProduct(intended: string, resolved: string, isAmazon: boolean): boolean {
  try {
    const host = (s: string) => new URL(s).hostname.replace(/^www\./i, '').toLowerCase()
    const ih = host(intended)
    const rh = host(resolved)
    if (isAmazon) return /(?:^|\.)amazon\.[a-z.]+$/.test(rh)
    return rh === ih || rh.endsWith('.' + ih) || ih.endsWith('.' + rh)
  } catch {
    return false
  }
}

export interface AffiliateResolveOpts {
  title: string
  description: string
  ownSite?: string | null
  userId: string
  tier?: string | null
  amazonTag?: string | null
  geniuslinkApiKey?: string | null
  geniuslinkApiSecret?: string | null
  /** When true (repair tool), resolve a geni.us/short source link down to its
   *  real Amazon product so we can rebuild the USER's own affiliate link, and
   *  discard junk Amazon pages (bad ASINs) so product discovery can run.
   *  Generation leaves a source Geniuslink as-is. */
  unwrapSourceLinks?: boolean
  /** YouTube video ID used as Amazon's ascsubtag — gives the user per-post
   *  earnings attribution in the Amazon Associates Tracking Report. Rides
   *  through Geniuslink's redirect. 11 chars, well under Amazon's 16-char
   *  cap. Pass when known; null/undefined keeps the URL un-subtagged. */
  videoId?: string | null
  /** Pre-resolved Geniuslink group ID for this site (see
   *  lib/geniuslink-group.ts). When provided, the wrapped link lands in
   *  this group so the dashboard shows clicks segmented by blog. When
   *  null/undefined, Geniuslink falls back to its default group. */
  geniuslinkGroupId?: number | null
  /** Note to attach to the Geniuslink entry — defaults to the title. Pass
   *  a richer string (e.g. "{post-slug} | {site-domain}") for filterable
   *  rows in Geniuslink's link list. */
  geniuslinkNote?: string | null
}

export interface AffiliateResolveResult {
  affiliateUrl: string | null
  asin: string | null
  destination: string | null
}

/**
 * Resolve the affiliate URL to promote for a video, in priority order:
 *   1. A valid ASIN in the title or a /dp/ ASIN in the description → Amazon.
 *   2. The creator's product link in the description (resolved; junk Amazon
 *      pages discarded so discovery can run).
 *   3. Amazon product discovery by title.
 * Then wrap with the user's Geniuslink (verified) or Amazon Associates tag.
 */
export async function resolveAffiliateUrl(opts: AffiliateResolveOpts): Promise<AffiliateResolveResult> {
  const {
    title, description, ownSite, userId, tier, amazonTag,
    geniuslinkApiKey, geniuslinkApiSecret, unwrapSourceLinks,
    videoId, geniuslinkGroupId, geniuslinkNote,
  } = opts

  let asin: string | null = null
  let destination: string | null = null

  // ── Step 1 — find a VALID ASIN or a real store destination ───────────────
  const titleAsin = extractAsin(title) // hardened: rejects 10-letter words
  const descAsin = description.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || null
  if (titleAsin) {
    asin = titleAsin
  } else if (descAsin && isValidAsin(descAsin)) {
    asin = descAsin
  } else {
    const pUrl = firstProductUrl(description, ownSite ?? null)
    if (pUrl) {
      const isGenius = GENIUSLINK.test(pUrl)
      const isShort = SHORTENERS.test(pUrl)
      if (isShort || (isGenius && unwrapSourceLinks)) {
        const finalUrl = await resolveTrueDestination(pUrl)
        const a = asinFromAmazonUrl(finalUrl)
        if (a && isValidAsin(a)) {
          asin = a
        } else if (!/amazon\.[a-z.]+/i.test(finalUrl)) {
          // A real non-Amazon store — keep it.
          destination = finalUrl
        }
        // else: an Amazon page with a junk ASIN (e.g. dp/UNDERWATER) — discard
        // so discovery can find the real product below.
      } else if (isGenius) {
        destination = pUrl // generation: keep the source Geniuslink as-is
      } else if (/^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(pUrl)) {
        const a = asinFromAmazonUrl(pUrl)
        if (a && isValidAsin(a)) asin = a
        else destination = pUrl
      } else {
        destination = pUrl // direct store / brand page
      }
    }
    if (!asin && !destination) {
      try {
        const discovered = await discoverProductForVideo(title, description, { userId, tier: tier ?? null })
        if (discovered?.asin && isValidAsin(discovered.asin)) asin = discovered.asin
      } catch { /* discovery failed — leave unresolved */ }
    }
  }

  if (asin) destination = `https://www.amazon.com/dp/${asin}`
  if (!destination) return { affiliateUrl: null, asin, destination: null }

  // Append Amazon's ascsubtag so the user sees per-video earnings in
  // their Amazon Associates dashboard. Rides through Geniuslink's
  // redirect; safe no-op for non-Amazon destinations.
  const subtaggedDestination = appendAmazonSubtag(destination, videoId)

  // ── Step 2 — turn the destination into the user's affiliate URL ──────────
  const tagFallback = (): string =>
    asin && amazonTag
      ? appendAmazonSubtag(`https://www.amazon.com/dp/${asin}?tag=${amazonTag}`, videoId)
      : subtaggedDestination

  let affiliateUrl: string
  if (geniuslinkApiKey && geniuslinkApiSecret) {
    try {
      const genius = createGeniuslinkService(geniuslinkApiKey, geniuslinkApiSecret)
      const wrapped = await genius.createLink(subtaggedDestination, title, {
        groupId: geniuslinkGroupId ?? undefined,
        note: geniuslinkNote ?? undefined,
      })
      const trueDest = await resolveTrueDestination(wrapped)
      affiliateUrl = pointsToIntendedProduct(destination, trueDest, !!asin) ? wrapped : tagFallback()
    } catch {
      affiliateUrl = tagFallback()
    }
  } else if (asin && amazonTag) {
    affiliateUrl = appendAmazonSubtag(`https://www.amazon.com/dp/${asin}?tag=${amazonTag}`, videoId)
  } else {
    affiliateUrl = subtaggedDestination
  }

  return { affiliateUrl, asin, destination }
}
