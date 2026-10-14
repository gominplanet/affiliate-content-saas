// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FINDING BRANDS, THE CREATOR'S WAY (Seb, 2026-10-14, after Rob's "Oink Blue
// for Trybe" video: "build all 4").
//
//   1. The brand on Amazon. Every MVP member is an Amazon influencer, so a
//      TRYBE brand they already filmed on Amazon is paid work with no new
//      filming. Read from what MVP already keeps: their own Amazon videos and
//      the products in them, their storefront, and Amazon's Creator
//      Connections catalog (which brands pay Amazon creators, and how much).
//   2. Their priorities weigh the Best bets score (lib/trybe-pick weighScore).
//   3. More filters: pay per video, creators, videos approved, has paid
//      creators, samples, on Amazon, starred, a brand's name.
//   4. Their stage: volume first, then double down. Seb: "especially at
//      first, it is good to understand how brands work and stick to volume..
//      once you see your winners with MVP, then you can focus on those and
//      really double and triple down on what matters and what pays."
//
// TRYBE's brand list was seen only in part, so each number below is found by
// the names it is likely to have, and a number TRYBE did not send is null:
// "not known", never zero. A filter says how many brands it could not check.

import { brandKey } from '@/lib/brand-normalize'
import type { Judged } from '@/lib/trybe-mybrands'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const NESTED = /brand|profile|company|stats|metrics|analytics|summary|counts|program|offer/i

/** The value under the first of these keys, on the entry or one level down
 *  in a brand or stats object. Pure. */
function find(o: Obj, keys: string[]): unknown {
  const at = (x: Obj, key: string) => {
    const k = Object.keys(x).find((n) => n.toLowerCase() === key.toLowerCase())
    const v = k ? x[k] : undefined
    return v == null || v === '' ? undefined : v
  }
  for (const key of keys) { const v = at(o, key); if (v !== undefined) return v }
  const nested = Object.entries(o).filter(([k, v]) => NESTED.test(k) && isObj(v)).map(([, v]) => v as Obj)
  for (const key of keys) for (const n of nested) { const v = at(n, key); if (v !== undefined) return v }
  return undefined
}
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}
const bool = (v: unknown): boolean | null => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null)

export interface DirStats {
  /** Videos the brand approved on TRYBE. */
  videosApproved: number | null
  /** What TRYBE says it has paid creators, in dollars. */
  paidOut: number | null
  /** Whether it takes sample requests. */
  samples: boolean | null
  /** When it joined TRYBE (ISO), when TRYBE says. */
  joinedAt: string | null
}

const APPROVED_KEYS = ['approvedVideos', 'approvedVideosCount', 'videosApproved', 'approvedSubmissions', 'approvedSubmissionsCount', 'acceptedVideos', 'videosAccepted', 'totalApprovedVideos', 'totalApprovedSubmissions', 'approvedCount', 'approved_videos', 'approved_submissions']
const PAID_KEYS = ['totalPaid', 'totalPaidOut', 'paidOut', 'totalPayout', 'totalPayouts', 'creatorPayouts', 'totalCreatorPayouts', 'paidToCreators', 'amountPaid', 'totalCreatorEarnings', 'creatorEarningsTotal', 'total_paid', 'paid_out']
const SAMPLE_KEYS = ['anySampleRequestsEnabled', 'sampleRequestsEnabled', 'allowSamples', 'samplesEnabled', 'offersSamples', 'hasSamples', 'samplesAvailable', 'allow_samples', 'samples_enabled']
const JOINED_KEYS = ['joinedAt', 'joinedTrybeAt', 'onboardedAt', 'launchedAt', 'createdAt', 'created_at', 'joined_at']

/** The numbers Oink shows per brand, from TRYBE's own list entry. Pure. */
export function readDirStats(raw: unknown): DirStats {
  if (!isObj(raw)) return { videosApproved: null, paidOut: null, samples: null, joinedAt: null }
  const when = find(raw, JOINED_KEYS)
  const t = typeof when === 'string' || typeof when === 'number' ? Date.parse(String(when)) : NaN
  const paid = find(raw, PAID_KEYS)
  // A paid-out figure in cents (a whole number field named *Cents) is dollars / 100.
  const centsKey = Object.keys(raw).find((k) => /paid.*cents|payout.*cents/i.test(k))
  return {
    videosApproved: num(find(raw, APPROVED_KEYS)),
    paidOut: centsKey && num(raw[centsKey]) != null ? (num(raw[centsKey]) as number) / 100 : num(paid),
    samples: bool(find(raw, SAMPLE_KEYS)),
    joinedAt: Number.isFinite(t) && t > Date.UTC(2020, 0, 1) ? new Date(t).toISOString() : null,
  }
}

/** Every key TRYBE's entries carry, one level deep, for the admin box: so
 *  what TRYBE sends is seen, not guessed. Pure. */
export function rawKeys(raws: unknown[], max = 60): string[] {
  const seen = new Set<string>()
  for (const r of raws.slice(0, 50)) {
    if (!isObj(r)) continue
    for (const [k, v] of Object.entries(r)) {
      seen.add(k)
      if (isObj(v)) for (const k2 of Object.keys(v)) seen.add(`${k}.${k2}`)
    }
  }
  return Array.from(seen).sort().slice(0, max)
}

// ── 1. THE BRAND ON AMAZON ──────────────────────────────────────────────────

export interface AmazonVideoProduct { aci: string; asin: string; title: string | null }
export interface CcCampaign { brand_name: string | null; asins: string[]; commission_pct: number | null; ends_at: string | null }
export interface AmazonOf {
  /** The creator's Amazon videos showing its products. */
  yourVideos: number
  /** Up to three of them (aci), for links. */
  videoAcis: string[]
  /** Products of it in the creator's storefront. */
  storefront: number
  /** Creator Connections campaigns running now. */
  ccCampaigns: number
  ccBestPct: number | null
  /** One of its products on Amazon, for a link. */
  asin: string | null
}

/** Name variants an exact brand_name lookup should try (Amazon writes
 *  "AUDIEN" or "Audien"). Pure. */
export function nameVariants(name: string): string[] {
  const n = name.replace(/\s+/g, ' ').trim()
  if (!n) return []
  const title = n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  return Array.from(new Set([n, n.toUpperCase(), n.toLowerCase(), title]))
}

/** The brand at the start of an Amazon product title: true when the title
 *  begins with the brand's name as whole words ("Audien Atom ONE..." for
 *  Audien). A name of under 3 letters never matches this way. Pure. */
export function titleIsBrand(title: string | null | undefined, brand: string): boolean {
  const key = brandKey(brand)
  if (key.length < 3) return false
  const words = String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5)
  let acc = ''
  for (const w of words) { acc += w; if (acc === key) return true; if (acc.length >= key.length) break }
  return false
}

/** What MVP knows of a TRYBE brand on Amazon, from the creator's own videos,
 *  their storefront brands, and the Creator Connections campaigns found for
 *  its name. A video counts when one of its products is one of the brand's
 *  campaign ASINs, or its title starts with the brand's name. Pure. */
export function amazonOf(name: string, input: { videos: AmazonVideoProduct[]; storefront: Map<string, number>; campaigns: CcCampaign[]; today: string }): AmazonOf {
  const key = brandKey(name)
  const mine = input.campaigns.filter((c) => brandKey(c.brand_name) === key && key.length >= 2)
  const live = mine.filter((c) => !c.ends_at || c.ends_at >= input.today)
  const ccAsins = new Set(mine.flatMap((c) => c.asins || []))
  const acis = new Set<string>()
  let asin: string | null = null
  for (const v of input.videos) {
    if (ccAsins.has(v.asin) || titleIsBrand(v.title, name)) { acis.add(v.aci); asin = asin || v.asin }
  }
  const pcts = live.map((c) => Number(c.commission_pct)).filter((n) => Number.isFinite(n) && n > 0)
  return {
    yourVideos: acis.size,
    videoAcis: Array.from(acis).slice(0, 3),
    storefront: input.storefront.get(key) ?? 0,
    ccCampaigns: live.length,
    ccBestPct: pcts.length ? Math.round(Math.max(...pcts) * 10) / 10 : null,
    asin: asin || (live.find((c) => c.asins?.length)?.asins[0] ?? null),
  }
}

/** Words too common in product names to tell two products apart. */
const PRODUCT_STOP = new Set(['the', 'and', 'for', 'with', 'new', 'pack', 'set', 'kit', 'pro', 'max', 'mini', 'plus', 'one', 'two', 'men', 'women', 'mens', 'womens', 'unisex', 'size', 'color', 'black', 'white', 'edition', 'version', 'original', 'premium', 'official'])

/** A TRYBE product's own words: lowercased, the brand's words and common
 *  words left out, 3 letters or more. Pure. */
export function productWords(product: string, brand: string): string[] {
  const brandW = new Set(String(brand).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  return Array.from(new Set(String(product).toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !brandW.has(w) && !PRODUCT_STOP.has(w) && !/^\d+$/.test(w))))
}

/** The creator's Amazon videos of ONE TRYBE product: a video product of the
 *  same brand (one of its campaign ASINs, or a title starting with its name)
 *  whose title has every one of the product's own words. A product with no
 *  words of its own ("Kings Loot") is never matched this way: that would be
 *  the brand, not the product. Pure. */
export function productOnAmazon(product: string, brand: string, videos: AmazonVideoProduct[], brandAsins: Set<string>): string[] {
  const words = productWords(product, brand)
  if (!words.length) return []
  const acis = new Set<string>()
  for (const v of videos) {
    if (!(brandAsins.has(v.asin) || titleIsBrand(v.title, brand))) continue
    const t = String(v.title || '').toLowerCase()
    if (words.every((w) => new RegExp(`\\b${w}`).test(t))) acis.add(v.aci)
  }
  return Array.from(acis)
}

export const onAmazon = (a: AmazonOf | null | undefined) => !!a && (a.yourVideos > 0 || a.storefront > 0 || a.ccCampaigns > 0)

// ── 3. FILTERS ──────────────────────────────────────────────────────────────

export interface FinderFilters {
  minPerVideo?: number | null
  maxCreators?: number | null
  maxVideos?: number | null
  paidCreators?: boolean
  samples?: boolean
  onAmazon?: boolean
  starred?: boolean
}

/** A filter body from the page, read safely. Pure. */
export function readFilters(v: unknown): FinderFilters {
  const o = isObj(v) ? v : {}
  const pos = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : null }
  return {
    minPerVideo: pos(o.minPerVideo), maxCreators: pos(o.maxCreators), maxVideos: pos(o.maxVideos),
    paidCreators: o.paidCreators === true, samples: o.samples === true, onAmazon: o.onAmazon === true, starred: o.starred === true,
  }
}

export interface FilterRow {
  perVideo: number | null
  creators: number | null
  stats: DirStats
  earningsBucket: string | null
  amazon: AmazonOf | null
  starred: boolean
}
export type FilterId = 'minPerVideo' | 'maxCreators' | 'maxVideos' | 'paidCreators' | 'samples' | 'onAmazon' | 'starred'

/** Where a brand stands with each filter that is on: passes, fails, or not
 *  known (TRYBE did not say). Pure. */
export function filterCheck(r: FilterRow, f: FinderFilters): { pass: boolean; unknown: FilterId[]; failed: FilterId[] } {
  const unknown: FilterId[] = []
  const failed: FilterId[] = []
  const judge = (id: FilterId, v: boolean | null) => { if (v === null) unknown.push(id); else if (!v) failed.push(id) }
  if (f.minPerVideo) judge('minPerVideo', r.perVideo == null ? null : r.perVideo >= f.minPerVideo)
  if (f.maxCreators) judge('maxCreators', r.creators == null ? null : r.creators <= f.maxCreators)
  if (f.maxVideos) judge('maxVideos', r.stats.videosApproved == null ? null : r.stats.videosApproved <= f.maxVideos)
  if (f.paidCreators) judge('paidCreators', r.stats.paidOut != null ? r.stats.paidOut > 0 : r.earningsBucket ? true : null)
  if (f.samples) judge('samples', r.stats.samples)
  // Not found on Amazon is a no: MVP looked (its catalog, your videos).
  if (f.onAmazon) judge('onAmazon', onAmazon(r.amazon))
  if (f.starred) judge('starred', r.starred)
  return { pass: !failed.length, unknown, failed }
}

export const FILTER_WORDS: Record<FilterId, string> = {
  minPerVideo: 'pay per video', maxCreators: 'creator count', maxVideos: 'videos approved',
  paidCreators: 'what it has paid creators', samples: 'samples', onAmazon: 'Amazon', starred: 'stars',
}

// ── 4. YOUR STAGE: VOLUME FIRST, THEN DOUBLE DOWN ──────────────────────────

export type Stage = 'start' | 'volume' | 'double'
export interface StageRead {
  stage: Stage
  title: string
  says: string
  winners: string[]
  /** Brands joined, and videos decided across them: how much has been learned. */
  joined: number
  decided: number
}

/** Seb's way: ask many brands and film for each that says yes until MVP sees
 *  winners (brands that pay and approve: judgeBrands' focus), then put most
 *  of the videos into those, still asking new brands at a lower pace to find
 *  the next one. Pure. */
export function stageOf(judged: Judged[]): StageRead {
  const joined = judged.length
  const decided = judged.reduce((n, j) => n + (j.brand.approved ?? 0) + (j.brand.rejected ?? 0), 0)
  const winners = judged.filter((j) => j.verdict === 'focus').map((j) => j.brand.name)
  if (!joined) {
    return { stage: 'start', title: 'Start with volume', says: 'Ask many brands that fit your channel. Each one that says yes teaches you how brands approve and pay. MVP finds your winners from your own numbers as they come in.', winners, joined, decided }
  }
  if (!winners.length) {
    return {
      stage: 'volume', title: 'Volume: learn what pays',
      says: `You are in ${joined} brand${joined === 1 ? '' : 's'}${decided ? `, ${decided} video${decided === 1 ? '' : 's'} decided` : ''}. Keep asking new brands and film for every one that says yes. Once a brand pays you and approves your videos, MVP marks it a winner here.`,
      winners, joined, decided,
    }
  }
  const few = winners.length < 3
  return {
    stage: 'double', title: few ? 'Winners found: double down, keep testing' : 'Double down on your winners',
    says: few
      ? `${winners.join(' and ')} ${winners.length === 1 ? 'pays' : 'pay'} you. Put most of your videos into ${winners.length === 1 ? 'it' : 'them'} (This week plans 30 a month each), and keep asking new brands to find your next winner.`
      : `${winners.slice(0, 5).join(', ')} pay you. Put most of your videos into them: This week plans 30 a month each. Ask new brands at a slower pace, to replace any that slow down.`,
    winners, joined, decided,
  }
}
