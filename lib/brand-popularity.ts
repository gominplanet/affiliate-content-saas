// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW KNOWN A BRAND IS (Seb, 2026-10-21: "can we also look at the website's
// brand and see the traffic they create or they get? That will also give us
// like an idea of how viral or how searched their brand is").
//
// Two free reads, no key, no account, for every TRYBE brand in the shared
// directory (cron trybe-directory, migration 452):
//   - WEBSITE RANK: where the brand's own website stands among the world's
//     websites, from the Tranco list (built daily from Chrome's, Cloudflare's
//     and other traffic data; tranco-list.eu, one question a second). Its
//     ranks over about a month also say whether the site is climbing. It is a
//     rank, not a visit count, and MVP says so: no free source gives visits.
//   - GOOGLE SEARCHES: what Google's search box suggests after the brand's
//     name (lib/search-suggest). GentGolfers, with about 2,100 Meta ads
//     running, got ten ("gent golfers review", "gent golfers discount code",
//     "gent golfers reddit"); a brand nobody looks up gets none with its name.
//     Up to ten, so it says people search for it, not how many.
// And ADS PER CREATOR: the Meta ads running for each creator it has, the
// special search's order (a big ad budget shared by few creators). TRYBE's
// list gives no creator counts (Seb's check, 2026-10-21), so until it does,
// ADS PER REVIEW: Meta ads for each creator review on TRYBE (Seb: "ok do
// meta ads per review"). A review count says at least that many creators
// worked with the brand, so it is a floor, and MVP says so.
//
// A read that did not happen is "not read", never zero. A website that is a
// page on someone else's site (Amazon, Etsy, a link page, a social profile)
// is not ranked as the brand: amazon.com's rank says nothing about it. Pure
// except fetchWebRank; tested in scripts/test-brand-popularity.

import { brandKey } from '@/lib/brand-normalize'
import { cleanSearch } from '@/lib/search-suggest'

export type Tone = 'good' | 'info' | 'bad'
export interface Said { short: string; long: string; tone: Tone }

/** Read again after this long. */
export const POPULARITY_FRESH_MS = 14 * 86_400_000

/** A website that is a page on a shared site: its rank is that site's. */
const SHARED = /(^|\.)(amazon\.[a-z.]+|amzn\.to|etsy\.com|ebay\.[a-z.]+|walmart\.com|target\.com|bestbuy\.com|faire\.com|linktr\.ee|linktree\.com|beacons\.ai|bio\.link|stan\.store|carrd\.co|instagram\.com|facebook\.com|fb\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.com|linkedin\.com|myshopify\.com|shop\.app|shopify\.com|wixsite\.com|wix\.com|squarespace\.com|square\.site|godaddysites\.com|weebly\.com|wordpress\.com|blogspot\.com|google\.com|sites\.google\.com|gumroad\.com|kickstarter\.com|indiegogo\.com|bigcartel\.com|jointrybe\.com)$/i

/** Two-part endings, so brand.co.uk is ranked as brand.co.uk, not co.uk. */
const TWO_PART = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'com.br', 'co.jp', 'com.mx', 'co.za', 'com.sg', 'com.hk', 'co.in', 'co.kr', 'com.tr', 'com.cn', 'com.ar', 'com.co'])

/** The brand's own domain, as the Tranco list ranks it (brand.com for
 *  shop.brand.com), or null when it has no website of its own. Pure. */
export function siteDomain(website: string | null | undefined): string | null {
  const s = String(website || '').trim()
  if (!s) return null
  let host: string
  try { host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase() } catch { return null }
  host = host.replace(/^www\d?\./, '').replace(/\.$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || SHARED.test(host)) return null
  const parts = host.split('.')
  const two = parts.slice(-2).join('.')
  return TWO_PART.has(two) && parts.length >= 3 ? parts.slice(-3).join('.') : two
}

export interface WebRank { rank: number | null; was: number | null; days: number | null }

/** Tranco's answer for a domain: its latest rank, and the earliest in the
 *  answer with how many days lie between. No ranks: not ranked. Pure. */
export function readRanks(json: unknown): WebRank | null {
  const list = json && typeof json === 'object' ? (json as { ranks?: unknown }).ranks : undefined
  if (!Array.isArray(list)) return null
  const ranks = list
    .map((r) => ({ t: Date.parse(String((r as { date?: unknown })?.date || '')), n: Number((r as { rank?: unknown })?.rank) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.n) && r.n > 0)
    .sort((a, b) => b.t - a.t)
  if (!ranks.length) return { rank: null, was: null, days: null }
  const now = ranks[0], first = ranks[ranks.length - 1]
  const days = Math.round((now.t - first.t) / 86_400_000)
  return { rank: Math.round(now.n), was: days >= 5 ? Math.round(first.n) : null, days: days >= 5 ? days : null }
}

/** One question to the Tranco list. null when it did not answer (rate limit,
 *  down, timeout): not read, asked again on a later run. */
export async function fetchWebRank(domain: string): Promise<WebRank | null> {
  try {
    const r = await fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return readRanks(await r.json())
  } catch { return null }
}

const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n)

/** The website rank in words, or null when not read. Pure. */
export function webRankWords(p: { checked: boolean; domain: string | null; rank: number | null; was?: number | null; days?: number | null }): Said | null {
  if (!p.checked) return null
  const source = 'From the Tranco list of the world’s websites, built daily from Chrome, Cloudflare and other traffic data. A rank, not a visit count.'
  if (!p.domain) return { short: 'Website on a shared site', long: 'Its website is a page on another site (a store, a link page or a social profile), so its own visitors cannot be ranked.', tone: 'info' }
  if (p.rank == null) return { short: 'Website: few visitors', long: `${p.domain} is not ranked among the world’s websites: too few visitors to make the list. ${source}`, tone: 'info' }
  const r = p.rank
  const moved = p.was && p.days ? p.was / r : 1
  const trend = moved >= 1.25 ? 'climbing' : moved <= 0.8 ? 'falling' : null
  const since = p.was && p.days && trend ? ` ${trend === 'climbing' ? 'Up' : 'Down'} from #${p.was.toLocaleString('en-US')} ${p.days} days earlier.` : ''
  const band = r <= 100_000 ? { short: 'Website top 100K', what: 'one of the world’s 100,000 most visited websites', tone: 'good' as Tone }
    : r <= 1_000_000 ? { short: 'Website top 1M', what: 'in the world’s top million websites: real traffic', tone: 'good' as Tone }
      : { short: `Website #${compact(r)}`, what: 'some visitors, outside the top million', tone: 'info' as Tone }
  return {
    short: `${band.short}${trend ? `, ${trend}` : ''}`,
    long: `${p.domain} is ranked #${r.toLocaleString('en-US')}: ${band.what}.${since} ${source}`,
    tone: trend === 'climbing' && band.tone === 'info' ? 'good' : band.tone,
  }
}

/** The brand's name as Google is asked it: "GentGolfers" as "gent golfers",
 *  the way people type it. Pure. */
export function googleSeed(name: string): string {
  const split = String(name || '').replace(/([a-z]{3,})([A-Z][a-z]{2,})/g, '$1 $2')
  return cleanSearch(split.replace(/\b(inc|llc|ltd|co|corp|official)\b\.?/gi, ' '))
}

/** Of Google's suggestions, the searches that start with the brand's name
 *  ("gent golfers review" for GentGolfers; never "ridgeback dog" for Ridge).
 *  Pure. */
export function brandSearches(name: string, phrases: string[]): string[] {
  const key = brandKey(name)
  if (key.length < 3) return []
  const out: string[] = []
  for (const raw of phrases) {
    const p = cleanSearch(raw)
    let acc = ''
    for (const w of p.split(' ')) {
      // The same words left out as in the brand's key ("the", "shop", "inc").
      const k = brandKey(w)
      if (!k) continue
      acc += k
      if (acc === key) { if (!out.includes(p)) out.push(p); break }
      if (acc.length >= key.length) break
    }
  }
  return out.slice(0, 10)
}

/** What Google's suggestions say about the brand, or null when not read. Pure. */
export function googleWords(p: { checked: boolean; searches: number | null; phrases?: string[] | null }): Said | null {
  if (!p.checked || p.searches == null) return null
  const n = p.searches
  const like = (p.phrases || []).slice(0, 3).map((x) => `“${x}”`).join(', ')
  if (n === 0) return { short: 'Few Google searches', long: 'Google’s search box suggests nothing that starts with its name: few people look it up yet.', tone: 'info' }
  return {
    short: n >= 6 ? 'Searched on Google' : 'Some Google searches',
    long: `Google’s search box suggests ${n} search${n === 1 ? '' : 'es'} that start${n === 1 ? 's' : ''} with its name${like ? `, like ${like}` : ''}: people look it up. Google shows up to ten, so this says people search for it, not how many.`,
    tone: n >= 6 ? 'good' : 'info',
  }
}

/** Meta ads running for each creator it has (no creators counts as one), or
 *  null when either is not known. Pure. */
export function adsPerCreator(metaAds: number | null | undefined, creators: number | null | undefined): number | null {
  if (typeof metaAds !== 'number' || !Number.isFinite(metaAds) || typeof creators !== 'number' || !Number.isFinite(creators)) return null
  const r = metaAds / Math.max(1, creators)
  return r >= 10 ? Math.round(r) : Math.round(r * 10) / 10
}

/** Meta ads running for each creator review on TRYBE, or null when either is
 *  not known or it has no reviews. Pure. */
export function adsPerReview(metaAds: number | null | undefined, reviews: number | null | undefined): number | null {
  if (typeof reviews !== 'number' || !Number.isFinite(reviews) || reviews < 1) return null
  return adsPerCreator(metaAds, reviews)
}

/** Ads per review in words. Pure. */
export function adsPerReviewWords(metaAds: number, reviews: number): Said {
  const r = adsPerReview(metaAds, reviews) ?? 0
  return {
    short: `${r.toLocaleString('en-US')} Meta ad${r === 1 ? '' : 's'} per review`,
    long: `${metaAds.toLocaleString('en-US')} Meta ads running now and ${reviews.toLocaleString('en-US')} creator review${reviews === 1 ? '' : 's'} on TRYBE. TRYBE does not say how many creators a brand has; its reviews say at least that many worked with it.`,
    tone: r >= 5 ? 'good' : r >= 1 ? 'info' : 'bad',
  }
}

/** Ads per creator in words. Pure. */
export function adsPerCreatorWords(metaAds: number, creators: number): Said {
  const r = adsPerCreator(metaAds, creators) ?? 0
  const who = creators === 0 ? 'no creators yet' : `${creators.toLocaleString('en-US')} creator${creators === 1 ? '' : 's'}`
  return {
    short: `${r.toLocaleString('en-US')} Meta ad${r === 1 ? '' : 's'} per creator`,
    long: `${metaAds.toLocaleString('en-US')} Meta ads running now and ${who} on TRYBE: ${metaAds === 0 ? 'no ad budget showing' : r >= 5 ? 'a big ad budget shared by few creators' : 'its ads shared among its creators'}.`,
    tone: r >= 5 ? 'good' : r >= 1 ? 'info' : 'bad',
  }
}
