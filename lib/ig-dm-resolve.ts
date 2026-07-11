// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Paste a product URL → get the affiliate link + product facts" for the
// Instagram Auto-DM Reel composer. The creator drops any product URL (an Amazon
// page, a geni.us short link, or any store) and we:
//   1. turn it into THEIR affiliate link (Geniuslink if configured, else a
//      tagged Amazon link) — reusing the exact blog-pipeline logic so the DM'd
//      link matches everything else MVP produces;
//   2. pull the product name + a few facts to seed the caption.
//
// It never throws — a bad/blocked URL just yields whatever it could resolve, and
// the composer stays editable so the creator can fill the gaps.

import { resolveAffiliateUrl } from '@/lib/affiliate-resolve'
import { fetchAmazonProduct } from '@/services/amazon'

export interface CampaignProductResolve {
  /** The creator's affiliate link to DM. Null if nothing resolved. */
  affiliateUrl: string | null
  /** Best product name we found (Amazon title, og:title, or URL-derived). */
  productName: string | null
  /** A short factual blurb to feed the caption writer (from bullets/meta). */
  description: string
  asin: string | null
  destination: string | null
}

/** Block obviously-internal hosts before we fetch a pasted URL's page (SSRF). */
function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  // Literal private / loopback / link-local IPv4 + IPv6 loopback.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  if (h === '::1' || h === '[::1]') return false
  return true
}

function pickMeta(html: string, key: string): string | null {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i')
  const m = html.match(a) || html.match(b)
  return m?.[1]?.trim() || null
}

/** Turn a URL slug into a rough Title Case name as a last resort. */
function nameFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const slug = parts.reverse().find(p => /[a-z]/i.test(p) && !/^(dp|gp|product|ref|p)$/i.test(p))
    if (!slug) return null
    const words = decodeURIComponent(slug).replace(/[-_+]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim()
    if (words.length < 3) return null
    return words.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 120)
  } catch { return null }
}

/** Best-effort fetch of a non-Amazon product page's title + description. */
async function fetchPageMeta(url: string): Promise<{ title: string | null; description: string }> {
  if (!isPublicHttpUrl(url)) return { title: null, description: '' }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0; +https://www.mvpaffiliate.io)' },
    })
    clearTimeout(t)
    if (!res.ok) return { title: null, description: '' }
    const html = (await res.text()).slice(0, 200_000)
    const title = pickMeta(html, 'og:title') || pickMeta(html, 'twitter:title')
      || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null)
    const description = pickMeta(html, 'og:description') || pickMeta(html, 'description') || ''
    return { title, description }
  } catch {
    return { title: null, description: '' }
  }
}

export interface ResolveCtx {
  userId: string
  tier?: string | null
  amazonTag?: string | null
  geniuslinkApiKey?: string | null
  geniuslinkApiSecret?: string | null
}

/**
 * Resolve a pasted product URL into the creator's affiliate link + product facts.
 * Passes the URL through the shared affiliate pipeline (so a geni.us/short source
 * is unwrapped and re-wrapped with THIS creator's link), then enriches from
 * Amazon (by ASIN) or generic page meta.
 */
export async function resolveProductForCampaign(url: string, ctx: ResolveCtx): Promise<CampaignProductResolve> {
  const clean = (url || '').trim()
  const empty: CampaignProductResolve = { affiliateUrl: null, productName: null, description: '', asin: null, destination: null }
  if (!/^https?:\/\//i.test(clean)) return empty

  // 1. Affiliate link (feed the URL in as the "description" the resolver scans).
  let affiliateUrl: string | null = null
  let asin: string | null = null
  let destination: string | null = null
  try {
    const r = await resolveAffiliateUrl({
      title: '',
      description: clean,
      ownSite: null,
      userId: ctx.userId,
      tier: ctx.tier ?? null,
      amazonTag: ctx.amazonTag ?? null,
      geniuslinkApiKey: ctx.geniuslinkApiKey ?? null,
      geniuslinkApiSecret: ctx.geniuslinkApiSecret ?? null,
      unwrapSourceLinks: true, // re-wrap a geni.us/short source with the creator's own link
      geniuslinkNote: 'IG Auto-DM Reel',
    })
    affiliateUrl = r.affiliateUrl
    asin = r.asin
    destination = r.destination
  } catch { /* leave nulls; UI stays editable */ }

  // If nothing resolved, at least DM the cleaned URL itself.
  if (!affiliateUrl) affiliateUrl = destination || clean

  // 2. Product facts for the caption.
  let productName: string | null = null
  let description = ''
  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      productName = p.title || null
      description = Array.isArray(p.bullets) ? p.bullets.slice(0, 3).join('. ') : ''
    } catch { /* fall through to meta / url-derived */ }
  }
  if (!productName) {
    const meta = await fetchPageMeta(destination || clean)
    productName = meta.title || nameFromUrl(destination || clean)
    if (!description) description = meta.description || ''
  }

  return { affiliateUrl, productName, description: description.slice(0, 600), asin, destination }
}
