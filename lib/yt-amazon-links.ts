// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH PRODUCTS A YOUTUBE VIDEO LINKS TO (lib/yt-amazon-match; Seb,
// 2026-11-11). From its title (a B0 ASIN written in it) and its description:
// an Amazon product link is read as it is; the product links at the TOP of the
// description (lib/yt-amazon-match topLinks: above the first separator or
// heading, where a review's own link sits) are followed, hop by hop, until
// they show an ASIN. Following STOPS at any Amazon address: the ASIN is read
// from the address itself, and Amazon's own pages are never fetched. Every
// hop is checked as a public address first, and MVP says who it is.
//
// 2026-11-11, Seb's first run (3,539 videos, 3,248 not placed): every
// description carried a dozen gear links and eight promo links, and following
// all of them sent tens of thousands of requests to geni.us, which stopped
// answering, so the product link at the top failed with the rest. Now only
// the top block is followed, a link already resolved is never followed again
// (`known`), and a "slow down" answer is waited out and tried again.
//
// Later the same day, Seb's second run (109 read, 10 placed): his descriptions
// since 2025 say "Product ASIN: B0HKJZCSQV" under the price link, so that line
// is read first, with no request; and a link that does not answer now says
// where it was and what it said ("link-failed:mvpl.ink:403"), so the page can
// count the reasons instead of hiding them behind one sentence.
//
// Seb's third run (1,175 read, 161 with a product): mvpl.ink is MVP's own
// Passport. Its codes are in MVP's database with their ASIN, so the route looks
// them up (`resolve`) instead of following them: no click is logged, and no
// Levanta link or country store stands in for the product.
//
// Seb, later still: "most YouTube videos, if not all of them, will have a
// link". geni.us allows ten follows a minute (its ratelimit-limit header), and
// three readers at once spent that in seconds and kept asking: 15 of 25 of his
// 2025 videos came back "slow down". geni.us links are now read from the
// creator's Geniuslink account (lib/yt-amazon-geniuslink, through `resolve`),
// and a link service that says how long to wait is left alone until then:
// nothing is sent to it meanwhile, and the video is read again in a later round.
// Server only.

import { allProductUrls, RESOLVER_UA } from '@/lib/product-link'
import { asinFromAmazonUrl } from '@/lib/asin'
import { assertPublicHttpUrlResolved } from '@/lib/ssrf-guard'
import { labelAsins, titleAsins, topLinks } from '@/lib/yt-amazon-match'

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.com$/i

/** Hosts that asked MVP to wait, until when (ms). Shared by every reader in
 *  this process, so three readers do not each spend the allowance. */
const pausedUntil = new Map<string, number>()
/** For tests. */
export function forgetPauses(): void { pausedUntil.clear() }

/** When a link service says its allowance runs out ("ratelimit-remaining: 0",
 *  "ratelimit-reset: <epoch seconds>"), or how long a "slow down" lasts. */
function waitFrom(res: Response | null): number | null {
  if (!res) return null
  const after = Number(res.headers.get('retry-after'))
  if (Number.isFinite(after) && after > 0) return after * 1000
  const reset = Number(res.headers.get('ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 1e9) return Math.max(0, reset * 1000 - Date.now())
  return null
}

type Followed = { asin: string } | { why: 'amazon-not-product' | 'elsewhere' | 'link-failed' | 'rate-limited'; host: string; status?: number }

/** Where one link leads: an ASIN, or why not. Never throws. */
export async function followToAsin(url: string, waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<Followed> {
  let current = url
  let host = ''
  for (let hop = 0; hop <= 5; hop++) {
    const a = asinFromAmazonUrl(current)
    if (a) return { asin: a }
    try { host = new URL(current).hostname.toLowerCase() } catch { return { why: 'link-failed', host } }
    // Amazon itself is never fetched: an Amazon address with no ASIN is a
    // storefront, a search or a list, not one product.
    if (AMAZON_HOST.test(host)) return { why: 'amazon-not-product', host }
    // A service that asked MVP to wait is not asked again before it said.
    if ((pausedUntil.get(host) || 0) > Date.now()) return { why: 'rate-limited', host }
    try { await assertPublicHttpUrlResolved(current) } catch { return { why: 'link-failed', host } }
    let res: Response | null = null
    // A "slow down" (429) or a busy answer (503) is waited out, twice, when
    // the wait is short; a longer one pauses this service until it is over.
    for (let tryN = 0; tryN < 3; tryN++) {
      try {
        res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': RESOLVER_UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(8000) })
      } catch { res = null }
      try { await res?.body?.cancel() } catch { /* nothing to read */ }
      if (res && Number(res.headers.get('ratelimit-remaining')) === 0 && res.headers.get('ratelimit-remaining') !== null) {
        const w = waitFrom(res)
        pausedUntil.set(host, Date.now() + (w ?? 60_000))
      }
      if (res && res.status !== 429 && res.status !== 503) break
      const w = waitFrom(res)
      if (w !== null && w > 10_000) { pausedUntil.set(host, Date.now() + w); break }
      if (tryN < 2) await waitMs(w !== null ? w : 2000 * (tryN + 1))
    }
    if (!res) return { why: 'link-failed', host }
    if (res.status === 429 || res.status === 503) {
      if (res.status === 429 && !((pausedUntil.get(host) || 0) > Date.now())) pausedUntil.set(host, Date.now() + 60_000)
      return { why: 'rate-limited', host }
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { why: 'link-failed', host }
      try { current = new URL(loc, current).toString() } catch { return { why: 'link-failed', host } }
      continue
    }
    if (!res.ok && res.status !== 206 && res.status !== 416) return { why: 'link-failed', host, status: res.status }
    return { why: 'elsewhere', host }
  }
  return { why: 'link-failed', host }
}

/** The ASINs a video links to, in the order they appear, with where each came
 *  from; or, when none, why (lib/yt-amazon-match whyWords). `known` holds
 *  links already resolved (an ASIN, or null for one that leads elsewhere), and
 *  learns the ones followed here. */
/** What MVP already knows a link is (a Passport code: its ASIN, or where it
 *  leads), or null for a link it has to follow. */
export type LinkLookup = (url: string) => { asin?: string | null; url?: string | null } | null

export async function productsOfVideo(title: string, description: string, known: Map<string, string | null> = new Map(), resolve?: LinkLookup): Promise<{ asins: Array<{ asin: string; via: string }>; why: string | null; followed: number }> {
  const found = new Map<string, string>()
  for (const a of titleAsins(title)) found.set(a, 'title')
  const text = String(description || '')
  // "Product ASIN: B0..." says the video's product outright: nothing to follow.
  const labelled = labelAsins(text)
  for (const a of labelled) if (!found.has(a)) found.set(a, 'asin-label')
  if (labelled.length) return { asins: Array.from(found, ([asin, via]) => ({ asin, via })), why: null, followed: 0 }
  // Amazon product links anywhere cost nothing to read.
  for (const u of allProductUrls(text, null, 30)) { const d = asinFromAmazonUrl(u); if (d && !found.has(d)) found.set(d, u.slice(0, 300)) }
  // The links at the top are followed; with none there, the first two anywhere.
  const top = topLinks(text).filter((u) => allProductUrls(u, null, 1).length)
  const toFollow = (top.length ? top : allProductUrls(text, null, 2)).filter((u) => !asinFromAmazonUrl(u))
  const elsewhere = new Set<string>()
  let failed = 0
  let failedAt = ''
  let slowed = 0
  let notProduct = 0
  let followed = 0
  for (const u of toFollow) {
    const key = u.slice(0, 300)
    const own = resolve ? resolve(u) : null
    if (own?.asin) { const a = own.asin.toUpperCase(); known.set(key, a); if (!found.has(a)) found.set(a, key); continue }
    if (known.has(key)) { const k = known.get(key); if (k && !found.has(k)) found.set(k, key); continue }
    followed++
    const r = await followToAsin(own?.url || u)
    if ('asin' in r) { known.set(key, r.asin); if (!found.has(r.asin)) found.set(r.asin, key) }
    else if (r.why === 'elsewhere') { known.set(key, null); elsewhere.add(r.host.replace(/^www\./, '')) }
    else if (r.why === 'amazon-not-product') { known.set(key, null); notProduct++ }
    else if (r.why === 'rate-limited') slowed++
    else { failed++; if (!failedAt) failedAt = `${r.host.replace(/^www\./, '').replace(/:/g, '')}:${r.status || 0}` }
  }
  if (found.size) return { asins: Array.from(found, ([asin, via]) => ({ asin, via })), why: null, followed }
  // A storefront link is dropped as "not a product" before it is followed.
  if (!notProduct && /amazon\.[a-z.]+\/(shop|stores|s\?|b\?)/i.test(text)) notProduct = 1
  const why = slowed ? 'rate-limited' : failed ? `link-failed:${failedAt}` : elsewhere.size ? `elsewhere:${Array.from(elsewhere).slice(0, 4).join(',')}` : notProduct ? 'amazon-not-product' : 'no-link'
  return { asins: [], why, followed }
}
