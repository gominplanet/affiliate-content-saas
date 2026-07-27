// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Keepa API wrapper — the live-deals data source behind Amazon Deal Radar.
 *
 * Why Keepa (not scraping amazon.com/deals): crawling Amazon's retail deals
 * page violates the Associates Operating Agreement and risks every creator's
 * account. Keepa is a licensed price-history provider with a purpose-built Deal
 * endpoint (continuous price-drop detection, filterable by category / discount %
 * / price / rating), so we get an always-on deals feed with zero account risk.
 *
 * SHARED backend, not per-user: a deal is the same fact for everyone, so ONE
 * operator Keepa key (env KEEPA_API_KEY) feeds a central cache the whole
 * community reads. Cost scales with categories × refresh cadence, NOT user
 * count. (The per-user layer — which brand bounties a creator can actually
 * collect via Levanta/PartnerBoost — is handled separately, off their own keys.)
 *
 * ENTIRELY env-gated: with KEEPA_API_KEY unset every function is a safe no-op
 * (keepaConfigured()===false, deal fetches return []), so this ships dark and
 * lights up the moment the key is added — same contract as youtube-ingest.
 *
 * NOTE ON FIELD MAPPING: the Deal object's exact shape (image encoding, the
 * price-type index, lightningEnd units) is verified against a live key. The
 * normalization is deliberately isolated in `normalizeDeal()` + the small
 * helpers below so it's a one-place tweak once KEEPA_API_KEY is set. Everything
 * is defensive (guards every index) so a shape surprise yields nulls, never a
 * throw.
 *
 * Docs: https://keepa.com/#!discuss/t/deals/450  and  /request-deals
 */

const KEEPA_BASE = 'https://api.keepa.com'

/** Amazon marketplace → Keepa domainId. 1 = amazon.com (US). */
export const KEEPA_DOMAIN_US = 1

/** Keepa price-type index we treat as "the price". 0 = Amazon, 1 = Marketplace
 *  New. We read Amazon first and fall back to New. */
const PRICE_TYPE_AMAZON = 0
const PRICE_TYPE_NEW = 1
/** Keepa CSV type indices inside the `current`/history arrays. */
const KEEPA_CSV_RATING = 16        // star rating, stored as ×10 (45 = 4.5★)
const KEEPA_CSV_REVIEW_COUNT = 17  // number of reviews

export function keepaConfigured(): boolean {
  return !!process.env.KEEPA_API_KEY
}

/** Our normalized deal — exactly what deal_radar_cache stores. Prices in CENTS
 *  (integers) so the DB and filters never touch floats. */
export interface KeepaDeal {
  asin: string
  title: string
  brand: string | null
  imageUrl: string | null
  categoryId: number | null
  priceNowCents: number | null
  priceWasCents: number | null
  discountPct: number | null
  /** 0–5 stars (Keepa stores rating×10). */
  rating: number | null
  reviewCount: number | null
  salesRank: number | null
  dealType: 'lightning' | 'price_drop'
  /** ISO 8601 when a lightning deal ends, else null. */
  lightningEndsAt: string | null
}

/** Inputs for one Deal-endpoint page fetch. All optional — sane defaults below. */
export interface KeepaDealQuery {
  /** Keepa category ids to include (browse nodes). One feed per category keeps
   *  each call cheap and the results niche-sortable. */
  includeCategories?: number[]
  /** Minimum drop percent (e.g. 15 = at least 15% off). */
  minDiscountPct?: number
  /** [minCents, maxCents] current-price window. */
  priceRangeCents?: [number, number]
  /** Minimum star rating, 0–5. */
  minRating?: number
  /** 0-based page (Keepa returns up to 150 deals/page). */
  page?: number
  /** Look-back window: 0=day, 1=week, 2=month, 3=90 days. Default day. */
  dateRange?: 0 | 1 | 2 | 3
  domainId?: number
}

interface KeepaDealApiResponse {
  deals?: { dr?: unknown[] }
  tokensLeft?: number
  refillIn?: number
  refillRate?: number
  error?: { message?: string } | string
}

export interface KeepaDealPage {
  deals: KeepaDeal[]
  /** Keepa token accounting so the cron can back off before we run dry. */
  tokensLeft: number | null
  refillInMs: number | null
}

/**
 * Fetch ONE page of deals from Keepa's Deal endpoint. Returns an empty page on
 * unconfigured key or any failure (never throws) so the caller/cron just moves
 * on to the next category.
 */
export async function fetchKeepaDeals(query: KeepaDealQuery = {}): Promise<KeepaDealPage> {
  const key = process.env.KEEPA_API_KEY
  if (!key) return { deals: [], tokensLeft: null, refillInMs: null }

  // The Deal endpoint takes a single URL-encoded `selection` JSON object.
  const selection: Record<string, unknown> = {
    page: Math.max(0, query.page ?? 0),
    domainId: query.domainId ?? KEEPA_DOMAIN_US,
    // priceTypes[0] drives which price the delta/current refer to. 0 = Amazon.
    priceTypes: [PRICE_TYPE_AMAZON],
    // Only surface real drops. deltaPercentRange = [min, max] percent.
    deltaPercentRange: [Math.max(1, query.minDiscountPct ?? 15), 100],
    dateRange: query.dateRange ?? 0,
    // Sort by biggest percentage drop first (Keepa sortType 4 = deltaPercent).
    sortType: 4,
    isRangeEnabled: true,
  }
  if (query.includeCategories?.length) selection.includeCategories = query.includeCategories
  if (query.priceRangeCents) selection.currentRange = query.priceRangeCents
  if (typeof query.minRating === 'number') selection.minRating = Math.round(query.minRating * 10)

  const url = `${KEEPA_BASE}/deal?key=${encodeURIComponent(key)}&selection=${encodeURIComponent(JSON.stringify(selection))}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return { deals: [], tokensLeft: null, refillInMs: null }
    const data = (await res.json()) as KeepaDealApiResponse
    const raw = Array.isArray(data.deals?.dr) ? data.deals!.dr! : []
    const deals = raw.map(normalizeDeal).filter((d): d is KeepaDeal => !!d)
    return {
      deals,
      tokensLeft: Number.isFinite(data.tokensLeft as number) ? (data.tokensLeft as number) : null,
      refillInMs: Number.isFinite(data.refillIn as number) ? (data.refillIn as number) : null,
    }
  } catch {
    return { deals: [], tokensLeft: null, refillInMs: null }
  }
}

// ── Normalization (the one place to tweak once we have a live key) ───────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDeal(raw: any): KeepaDeal | null {
  if (!raw || typeof raw !== 'object') return null
  const asin = typeof raw.asin === 'string' ? raw.asin.trim().toUpperCase() : ''
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) return null

  const priceNowCents = pickPrice(raw.current)
  const priceWasCents = pickPrice(raw.avg) // trailing average = the "was" reference
  const discountPct = computeDiscount(priceNowCents, priceWasCents, raw.deltaPercent)

  // Keepa keeps rating + review count INSIDE the `current` array (CSV type
  // indices 16 = RATING as ×10, 17 = COUNT_REVIEWS), NOT as top-level fields —
  // reading raw.rating gave null on every deal. -1 means "no data".
  const cur = Array.isArray(raw.current) ? raw.current : []
  const ratingRaw = Number(cur[KEEPA_CSV_RATING])
  const reviewsRaw = Number(cur[KEEPA_CSV_REVIEW_COUNT])

  const lightningEndsAt = keepaMinutesToIso(raw.lightningEnd)
  return {
    asin,
    title,
    brand: typeof raw.brand === 'string' && raw.brand.trim() ? raw.brand.trim() : null,
    imageUrl: keepaImageUrl(raw.image),
    categoryId: Number.isFinite(raw.rootCat) ? Number(raw.rootCat) : (Array.isArray(raw.categories) && Number.isFinite(raw.categories[0]) ? Number(raw.categories[0]) : null),
    priceNowCents,
    priceWasCents,
    discountPct,
    rating: Number.isFinite(ratingRaw) && ratingRaw > 0 ? Math.min(5, Math.round(ratingRaw) / 10) : null,
    reviewCount: Number.isFinite(reviewsRaw) && reviewsRaw >= 0 ? reviewsRaw : null,
    salesRank: Number.isFinite(raw.salesRankReference) && raw.salesRankReference > 0 ? Number(raw.salesRankReference) : null,
    dealType: lightningEndsAt ? 'lightning' : 'price_drop',
    lightningEndsAt,
  }
}

/** Keepa price arrays are indexed by price-type; -1 means "no price". Prefer
 *  Amazon (0), fall back to New (1). Accepts the `current`/`avg` array shape. */
function pickPrice(arr: unknown): number | null {
  if (!Array.isArray(arr)) return null
  const amazon = arr[PRICE_TYPE_AMAZON]
  if (Number.isFinite(amazon) && (amazon as number) >= 0) return amazon as number
  const asNew = arr[PRICE_TYPE_NEW]
  if (Number.isFinite(asNew) && (asNew as number) >= 0) return asNew as number
  return null
}

/** Discount %: prefer Keepa's own deltaPercent[priceType] when present, else
 *  compute from now vs was. Clamped to 1–99, null when we can't tell. */
function computeDiscount(now: number | null, was: number | null, deltaPercent: unknown): number | null {
  if (Array.isArray(deltaPercent)) {
    const dp = deltaPercent[PRICE_TYPE_AMAZON] ?? deltaPercent[PRICE_TYPE_NEW]
    if (Number.isFinite(dp) && (dp as number) > 0) return Math.min(99, Math.max(1, Math.round(dp as number)))
  }
  if (now != null && was != null && was > now && was > 0) {
    return Math.min(99, Math.max(1, Math.round(((was - now) / was) * 100)))
  }
  return null
}

/** Keepa images: the deal `image` is the Amazon image file name (sometimes a
 *  byte array of its chars). Resolve to a full CDN URL. */
function keepaImageUrl(image: unknown): string | null {
  let name = ''
  if (typeof image === 'string') name = image
  else if (Array.isArray(image)) {
    try { name = String.fromCharCode(...(image as number[]).filter((n) => Number.isFinite(n) && n > 0)) } catch { name = '' }
  }
  name = name.trim()
  if (!name) return null
  // Some feeds already return a full URL.
  if (/^https?:\/\//i.test(name)) return name
  // Keepa gives just the file token, e.g. "51abcd.jpg".
  return `https://m.media-amazon.com/images/I/${name}`
}

/** Keepa timestamps are "Keepa minutes" = minutes since 2011-01-01 epoch:
 *  unixMillis = (keepaMinutes + 21564000) * 60000. Returns null for absent/0. */
function keepaMinutesToIso(keepaMinutes: unknown): string | null {
  if (!Number.isFinite(keepaMinutes) || (keepaMinutes as number) <= 0) return null
  const unixMs = ((keepaMinutes as number) + 21564000) * 60000
  const iso = new Date(unixMs).toISOString()
  // Guard against a wildly wrong epoch (bad unit) producing a nonsense year.
  const year = new Date(unixMs).getUTCFullYear()
  return year >= 2020 && year <= 2100 ? iso : null
}

// ── Price-history verification (the "is this a REAL deal?" layer) ─────────────
//
// Keepa's edge over a raw deals page: the full price history. We pull the
// computed stats for a product (1 token) and judge whether the "discount" is
// genuine (below its typical price / near an all-time low) or fake (a % off an
// inflated list price). This is what makes a deal badge trustworthy — and the
// same facts get baked into the generated post, honestly.

/** How good a deal actually is, judged against its own price history. */
export type DealQuality = 'excellent' | 'genuine' | 'fair' | 'weak'

export interface DealAssessment {
  currentCents: number | null
  /** Typical recent price (90-day average). */
  avg90Cents: number | null
  /** All-time low Keepa has ever recorded. */
  allTimeLowCents: number | null
  /** How far below the 90-day average the current price sits (0–99), or null. */
  pctBelowAvg90: number | null
  quality: DealQuality | null
  /** Short human badge, e.g. "All-time low" / "32% below its usual price". */
  label: string | null
  /** Amazon's "X+ bought in the past month" figure (the lower bound, e.g. 500
   *  = "500+ bought"). Null when Amazon shows no badge for this product — which
   *  is most of them, so treat absence as "unknown", not "zero sales". */
  monthlySold: number | null
}

/**
 * Fetch a product's computed price stats from Keepa and assess the deal.
 * ~1 token. Returns an all-null assessment on unconfigured key or any failure
 * (never throws) so the caller just skips verification for that ASIN.
 */
export async function fetchKeepaProductStats(asin: string, domainId = KEEPA_DOMAIN_US): Promise<DealAssessment> {
  const empty: DealAssessment = { currentCents: null, avg90Cents: null, allTimeLowCents: null, pctBelowAvg90: null, quality: null, label: null, monthlySold: null }
  const key = process.env.KEEPA_API_KEY
  if (!key || !/^[A-Za-z0-9]{10}$/.test(asin)) return empty
  // stats=180 → Keepa computes avg30/90/180 + all-time min/max server-side.
  // history=0 keeps the response light (we only need the stats block).
  const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${asin}&stats=180&history=0`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return empty
    const data = await res.json() as { products?: unknown[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product = (Array.isArray(data.products) ? (data.products[0] as any) : null)
    if (!product?.stats) return empty
    const assessment = assessFromStats(product.stats)
    // monthlySold rides on the SAME /product response (top-level, not in stats),
    // so we get it for free. Keepa uses -1 / absent for "no badge".
    const ms = Number(product.monthlySold)
    assessment.monthlySold = Number.isFinite(ms) && ms > 0 ? ms : null
    return assessment
  } catch {
    return empty
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assessFromStats(stats: any): DealAssessment {
  const currentCents = statPrice(stats.current)
  const avg90Cents = statPrice(stats.avg90) ?? statPrice(stats.avg30) ?? statPrice(stats.avg)
  const allTimeLowCents = statMinPrice(stats.min)

  let pctBelowAvg90: number | null = null
  if (currentCents != null && avg90Cents != null && avg90Cents > 0 && currentCents < avg90Cents) {
    pctBelowAvg90 = Math.min(99, Math.max(0, Math.round(((avg90Cents - currentCents) / avg90Cents) * 100)))
  }

  const nearAllTimeLow = currentCents != null && allTimeLowCents != null && allTimeLowCents > 0
    && currentCents <= allTimeLowCents * 1.02

  let quality: DealQuality | null = null
  let label: string | null = null
  if (currentCents != null && (avg90Cents != null || allTimeLowCents != null)) {
    if (nearAllTimeLow) { quality = 'excellent'; label = 'All-time low' }
    else if ((pctBelowAvg90 ?? 0) >= 15) { quality = 'genuine'; label = `${pctBelowAvg90}% below its usual price` }
    else if ((pctBelowAvg90 ?? 0) >= 5) { quality = 'fair'; label = 'Below its usual price' }
    else { quality = 'weak'; label = 'Around its usual price' }
  }

  return { currentCents, avg90Cents, allTimeLowCents, pctBelowAvg90, quality, label, monthlySold: null }
}

/** A Keepa stats price field is an int[] indexed by price type; -1 = none. */
function statPrice(arr: unknown): number | null {
  if (!Array.isArray(arr)) return null
  const a = arr[PRICE_TYPE_AMAZON]
  if (Number.isFinite(a) && (a as number) >= 0) return a as number
  const n = arr[PRICE_TYPE_NEW]
  if (Number.isFinite(n) && (n as number) >= 0) return n as number
  return null
}

/** stats.min is per-type [keepaTime, priceCents]; pull the Amazon/New price. */
function statMinPrice(min: unknown): number | null {
  if (!Array.isArray(min)) return null
  for (const type of [PRICE_TYPE_AMAZON, PRICE_TYPE_NEW]) {
    const entry = min[type]
    if (Array.isArray(entry) && Number.isFinite(entry[1]) && (entry[1] as number) >= 0) return entry[1] as number
  }
  return null
}

/**
 * Turn an assessment into ONE factual, FTC-honest sentence for the generated
 * deal post — only claims the data supports. Empty string when we have nothing
 * to say (so the caller can drop it cleanly).
 */
export function buildPriceContext(a: DealAssessment): string {
  const usd = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`)
  const now = usd(a.currentCents)
  const typical = usd(a.avg90Cents)
  if (a.quality === 'excellent' && now) {
    return typical
      ? `At ${now}, this is the lowest price we've seen — it typically sells for around ${typical}.`
      : `At ${now}, this is the lowest price we've seen on this item.`
  }
  if (a.quality === 'genuine' && now && typical && a.pctBelowAvg90 != null) {
    return `At ${now}, it's about ${a.pctBelowAvg90}% below its usual ${typical}.`
  }
  if (a.quality === 'fair' && now && typical) {
    return `At ${now}, it's running a little under its usual ${typical}.`
  }
  return ''
}
