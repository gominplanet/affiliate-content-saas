// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared product-link resolution for the YouTube → product pipelines (blog
// post generation AND YouTube Co-Pilot metadata). Encodes the user's content
// conventions:
//   - The reviewed product's link lives in the FIRST sentences of the video
//     description — it may be an Amazon link, a Geniuslink (any destination),
//     a short link, OR a direct store/brand product page.
//   - HARD RULE: never blindly Amazon-search for a lookalike when the creator
//     linked the product directly. Prefer the link that's actually there.

import { extractAsin } from '@/services/amazon'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'

/** Pull a 10-char Amazon ASIN out of an Amazon product URL path. */
export function asinFromAmazonUrl(url: string): string | null {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * Find the product link a creator points buyers to in a video description.
 * geni.us / amzn.to are NOT skipped — the creator's product link may BE a
 * Geniuslink or an Amazon short link. We only skip socials, payments, tip
 * jars / donation pages, link hubs, and the creator's own site. Prefers a URL
 * right after a buy/price CTA, else the first non-excluded URL.
 *
 * Tip jars matter: creators routinely put a "Buy Me a Coffee" / Ko-fi /
 * PayPal donation link near the TOP of the description. Without skipping
 * those, the resolver picked the tip jar as the "product" — so the post's
 * affiliate link (and the dashboard "Visit Product" link) sent readers to a
 * coffee donation page instead of the reviewed product.
 */
export function firstProductUrl(description: string, ownSite?: string | null): string | null {
  const skip = /(youtu\.?be|youtube\.com|instagram\.com|tiktok\.com|facebook\.com|fb\.com|twitter\.com|x\.com|linktr\.ee|linkedin\.com|pinterest\.|threads\.net|bsky\.|t\.me|discord\.|patreon\.|paypal\.|buymeacoffee\.com|buymeacoff\.ee|ko-?fi\.com|gofundme\.com|cash\.app|venmo\.com|streamlabs\.com|streamelements\.com|alexmediacreations)/i
  const own = ownSite ? ownSite.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
  const candidate = (raw: string): string | null => {
    const clean = raw.replace(/[.,;:)\]>"']+$/, '')
    if (skip.test(clean)) return null
    if (own && clean.includes(own)) return null
    return clean
  }
  // 1. URL right after a buy/price/availability cue — the product link.
  const cta = description.match(/(?:today'?s price|price|availability|buy(?:\s+it)?|shop|purchase|order|get yours|grab|available (?:here|at)|here)\b[:\s]*[\s\S]{0,40}?(https?:\/\/[^\s)>\]"']+)/i)
  if (cta) { const c = candidate(cta[1]); if (c) return c }
  // 2. Else the first non-excluded URL anywhere.
  for (const raw of description.match(/https?:\/\/[^\s)>\]"']+/gi) || []) {
    const c = candidate(raw); if (c) return c
  }
  return null
}

// Bot-identifying User-Agent for internal redirect-resolution. We follow
// geni.us / short links server-side ONLY to learn or verify a destination — not
// a real visitor click. A browser UA ('Mozilla/5.0') made Geniuslink (and other
// redirectors) log these as CLICKS, inflating the creator's stats. Announcing
// ourselves as a bot opts us out of click counting on services that filter bots.
const RESOLVER_UA = 'MVPAffiliateResolverBot/1.0 (+https://www.mvpaffiliate.io/bot; link verification, not a visitor)'

/** Follow a short link / redirect to its FINAL destination. Hard 5s timeouts
 *  so a slow host can't stall a generation request. Returns the original URL
 *  on failure. Uses a bot UA so click-tracking redirectors don't count these
 *  internal resolution hits as real clicks. */
export async function resolveFinalUrl(url: string): Promise<string> {
  // SSRF guard: this URL comes from a video description / brand-recap product
  // field — user-influenced. Refuse to open a socket to a private/reserved
  // host or a non-http scheme. We keep the never-throw contract: a blocked
  // URL is simply returned un-resolved (callers then fail to extract an ASIN
  // and fall back to discovery), never fetched.
  try {
    assertPublicHttpUrl(url)
  } catch {
    return url
  }
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': RESOLVER_UA }, signal: AbortSignal.timeout(5000) })
    return res.url || url
  } catch {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': RESOLVER_UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(5000) })
      return res.url || url
    } catch {
      return url
    }
  }
}

const SHORTENERS = /(?:amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i
const GENIUSLINK = /(?:geni\.us|\bgnz\.)/i

export type ResolvedProductLink =
  | { kind: 'amazon'; asin: string }
  | { kind: 'store'; url: string; alreadyGeniuslink: boolean }
  | { kind: 'none' }

/**
 * Resolve what to promote from a video's title + description, in priority
 * order — WITHOUT doing any Amazon search (callers fall back to their own
 * discovery only when this returns 'none'):
 *   1. Amazon ASIN in the title or a /dp/ ASIN in the description → Amazon.
 *   2. A Geniuslink in the description → store link, kept as-is.
 *   3. A short link → resolved; if it lands on an Amazon product → Amazon,
 *      else the store URL it points to.
 *   4. A direct store / brand product URL → store link.
 *   5. Nothing usable → 'none'.
 */
export async function resolveProductLink(title: string, description: string, ownSite?: string | null): Promise<ResolvedProductLink> {
  // Hardened: extractAsin rejects 10-letter words (e.g. "UNDERWATER") that the
  // old bare /[A-Z0-9]{10}/ matcher wrongly treated as ASINs.
  const titleAsin = extractAsin(title)
  const descAsin = description.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || null
  if (titleAsin) return { kind: 'amazon', asin: titleAsin.toUpperCase() }
  if (descAsin) return { kind: 'amazon', asin: descAsin }

  const pUrl = firstProductUrl(description, ownSite)
  if (!pUrl) return { kind: 'none' }

  if (GENIUSLINK.test(pUrl)) return { kind: 'store', url: pUrl, alreadyGeniuslink: true }
  if (SHORTENERS.test(pUrl)) {
    const finalUrl = await resolveFinalUrl(pUrl)
    const a = asinFromAmazonUrl(finalUrl)
    if (a) return { kind: 'amazon', asin: a }
    return { kind: 'store', url: finalUrl, alreadyGeniuslink: false }
  }
  if (/^https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(pUrl)) {
    const a = asinFromAmazonUrl(pUrl)
    if (a) return { kind: 'amazon', asin: a }
  }
  return { kind: 'store', url: pUrl, alreadyGeniuslink: false }
}
