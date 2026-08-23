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

/** The major marketplaces a US affiliate's geo-routed (OneLink/Geniuslink)
 *  traffic actually lands on — the set worth a cross-marketplace availability
 *  check on the deep-dive. Kept small so the check stays a few tokens. */
export const KEEPA_MARKETPLACES: Array<{ domain: number; code: string; label: string }> = [
  { domain: 1, code: 'US', label: 'United States' },
  { domain: 2, code: 'UK', label: 'United Kingdom' },
  { domain: 3, code: 'DE', label: 'Germany' },
  { domain: 6, code: 'CA', label: 'Canada' },
]

/** Amazon's own US seller id — an offer from this seller means "Amazon sells it
 *  directly", the strongest signal a listing is not a 3rd-party-only reseller. */
const AMAZON_US_SELLER_ID = 'ATVPDKIKX0DER'

/** Keepa price-type index we treat as "the price". 0 = Amazon, 1 = Marketplace
 *  New. We read Amazon first and fall back to New. */
const PRICE_TYPE_AMAZON = 0
const PRICE_TYPE_NEW = 1
/** Keepa CSV index 8 = Lightning Deal price — the flash-sale feed. */
export const PRICE_TYPE_LIGHTNING = 8
/** Keepa CSV type index 18 = Buy Box price (incl. shipping) — the price in the
 *  "Add to Cart" box, i.e. what a shopper ACTUALLY pays on the page. For items
 *  Amazon doesn't sell itself (3rd-party sold), Amazon(0) is absent and New(1)
 *  is the cheapest marketplace offer, which is often NOT the Buy Box winner
 *  (Amazon weighs shipping / Prime / seller rating). Reading New(1) is why a
 *  catalog price could show lower than the real page price. Requires &buybox=1
 *  on the /product request for the Buy Box stats to be present. */
const PRICE_TYPE_BUY_BOX = 18
/** Keepa CSV type indices inside the `current`/history arrays. */
const KEEPA_CSV_RATING = 16        // star rating, stored as ×10 (45 = 4.5★)
const KEEPA_CSV_REVIEW_COUNT = 17  // number of reviews
const KEEPA_CSV_SALES = 3          // sales rank (lower = better-selling)

// ── Shared product "extras" parse ────────────────────────────────────────────
// Signals every /product response already carries (no extra tokens) that we now
// surface on the cards: parent ASIN, current sales rank + its named category,
// coarse category, and the product's first-listed date (age). Used by both
// fetchKeepaProductCard and fetchKeepaProductStats.
export interface KeepaExtras {
  parentAsin: string | null
  salesRank: number | null
  /** 90-day average sales rank — for a rank-trend read (now vs avg). */
  salesRankAvg90: number | null
  salesRankCategory: string | null
  /** ISO date (YYYY-MM-DD) the product was first listed, for a product-age read. */
  listedSince: string | null
  /** Coarse Amazon product group / category-tree root, a readable string. */
  category: string | null
}

/** Keepa Time Minutes → ISO date (YYYY-MM-DD). Allows older listing years than
 *  keepaMinutesToIso (products can predate 2020), so it's a separate helper. */
function keepaMinutesToDate(min: unknown): string | null {
  const m = Number(min)
  if (!Number.isFinite(m) || m <= 0) return null
  const ms = (m + 21564000) * 60000 // Keepa epoch offset → unix ms
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  if (isNaN(d.getTime()) || y < 2000 || y > 2100) return null
  return d.toISOString().slice(0, 10)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseKeepaExtras(p: any): KeepaExtras {
  const parentAsin = (typeof p?.parentAsin === 'string' && /^[A-Z0-9]{10}$/i.test(p.parentAsin))
    ? p.parentAsin.toUpperCase() : null
  const cur = Array.isArray(p?.stats?.current) ? p.stats.current : []
  const rankRaw = Number(cur[KEEPA_CSV_SALES])
  const salesRank = Number.isFinite(rankRaw) && rankRaw > 0 ? rankRaw : null
  const avg90 = Array.isArray(p?.stats?.avg90) ? p.stats.avg90 : []
  const rankAvgRaw = Number(avg90[KEEPA_CSV_SALES])
  const salesRankAvg90 = Number.isFinite(rankAvgRaw) && rankAvgRaw > 0 ? rankAvgRaw : null
  // Named category for the rank: the categoryTree node matching salesRankReference,
  // else the tree leaf (most-specific), else null.
  const tree = Array.isArray(p?.categoryTree) ? p.categoryTree : []
  const refId = Number(p?.salesRankReference)
  let salesRankCategory: string | null = null
  if (tree.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = Number.isFinite(refId) && refId > 0 ? tree.find((c: any) => Number(c?.catId) === refId) : null
    const node = match || tree[tree.length - 1]
    const nm = node && typeof node.name === 'string' ? node.name.trim() : ''
    salesRankCategory = nm ? nm.slice(0, 60) : null
  }
  const rootName = tree.length ? String((tree[0] as { name?: unknown } | undefined)?.name || '').trim() : ''
  const category = (typeof p?.productGroup === 'string' && p.productGroup.trim())
    ? p.productGroup.trim().slice(0, 80)
    : (rootName ? rootName.slice(0, 80) : null)
  const listedSince = keepaMinutesToDate(p?.listedSince) ?? keepaMinutesToDate(p?.trackingSince)
  return { parentAsin, salesRank, salesRankAvg90, salesRankCategory, listedSince, category }
}

export function keepaConfigured(): boolean {
  return !!process.env.KEEPA_API_KEY
}

/** Live Keepa token balance for the operator key — the shared budget that Deal
 *  Radar, CC enrichment, and the AMZ Product Finder all draw from. Hits Keepa's
 *  /token endpoint, which does NOT consume product tokens, so it's safe to poll
 *  for a monitoring readout. Returns nulls when unconfigured or on any error. */
export interface KeepaTokenStatus {
  tokensLeft: number | null
  /** Tokens refilled per minute (Keepa refills continuously). */
  refillRate: number | null
  /** Ms until the next refill tick. */
  refillIn: number | null
}
export async function fetchKeepaTokenStatus(): Promise<KeepaTokenStatus> {
  const empty: KeepaTokenStatus = { tokensLeft: null, refillRate: null, refillIn: null }
  const key = process.env.KEEPA_API_KEY
  if (!key) return empty
  try {
    const res = await fetch(`${KEEPA_BASE}/token?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return empty
    const d = await res.json() as { tokensLeft?: number; refillRate?: number; refillIn?: number }
    return {
      tokensLeft: Number.isFinite(d.tokensLeft as number) ? (d.tokensLeft as number) : null,
      refillRate: Number.isFinite(d.refillRate as number) ? (d.refillRate as number) : null,
      refillIn: Number.isFinite(d.refillIn as number) ? (d.refillIn as number) : null,
    }
  } catch { return empty }
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
  /** Keepa CSV price types the deal is measured against. Default [0] (Amazon).
   *  Pass [8] (LIGHTNING_DEAL) for the Lightning-deals feed. priceTypes[0]
   *  drives which price the delta/current refer to. */
  priceTypes?: number[]
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
    // priceTypes[0] drives which price the delta/current refer to. 0 = Amazon,
    // 8 = Lightning Deal (the flash-sale feed).
    priceTypes: query.priceTypes?.length ? query.priceTypes : [PRICE_TYPE_AMAZON],
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
  /** Whether the listing carries a brand/merchant video in its image carousel.
   *  TRI-STATE: true = confirmed, false = checked & none, null = Keepa returned
   *  no `videos` data this call (unknown — don't overwrite a prior known value). */
  hasCarouselVideo: boolean | null
  /** Extra card signals riding the same response: parent ASIN, sales rank + its
   *  named category, coarse category, and first-listed date. Null on absence. */
  parentAsin: string | null
  salesRank: number | null
  salesRankAvg90: number | null
  salesRankCategory: string | null
  listedSince: string | null
  category: string | null
}

/**
 * Fetch a product's computed price stats from Keepa and assess the deal.
 * ~1 token. Returns an all-null assessment on unconfigured key or any failure
 * (never throws) so the caller just skips verification for that ASIN.
 */
export async function fetchKeepaProductStats(asin: string, domainId = KEEPA_DOMAIN_US): Promise<DealAssessment> {
  const empty: DealAssessment = { currentCents: null, avg90Cents: null, allTimeLowCents: null, pctBelowAvg90: null, quality: null, label: null, monthlySold: null, hasCarouselVideo: null, parentAsin: null, salesRank: null, salesRankAvg90: null, salesRankCategory: null, listedSince: null, category: null }
  const key = process.env.KEEPA_API_KEY
  if (!key || !/^[A-Za-z0-9]{10}$/.test(asin)) return empty
  // stats=180 → Keepa computes avg30/90/180 + all-time min/max server-side.
  // history=0 keeps the response light (we only need the stats block).
  // videos=1 → include the listing's video metadata (CACHED — we deliberately
  // do NOT pass `offers`, which would force a live, multi-token refresh). This
  // rides on the same call we're already making, so it costs ~nothing extra.
  const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${asin}&stats=180&history=0&videos=1`
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
    // Carousel-video flag rides on the same response too (top-level `videos`).
    assessment.hasCarouselVideo = detectCarouselVideo(product.videos)
    // Parent ASIN, sales rank + named category, category, first-listed date —
    // all already in this response.
    const extras = parseKeepaExtras(product)
    assessment.parentAsin = extras.parentAsin
    assessment.salesRank = extras.salesRank
    assessment.salesRankAvg90 = extras.salesRankAvg90
    assessment.salesRankCategory = extras.salesRankCategory
    assessment.listedSince = extras.listedSince
    assessment.category = extras.category
    return assessment
  } catch {
    return empty
  }
}

/** Lightweight per-ASIN basics for enriching the EPC library: image, sales rank
 *  and monthly-sold. One /product call covers up to 100 ASINs. */
export interface KeepaBasic {
  asin: string
  imageUrl: string | null
  salesRank: number | null
  salesRankCategory: string | null
  monthlySold: number | null
}

/**
 * Batch-fetch basics for many ASINs (image + sales rank + monthly sold), keyed by
 * ASIN. Keepa's /product accepts up to 100 ASINs per call, so a whole EPC scan is
 * usually one request. Never throws — a failed batch just yields no entries for
 * those ASINs, so the caller keeps whatever it already had.
 */
export async function fetchKeepaBasics(asins: string[], domainId = KEEPA_DOMAIN_US): Promise<Map<string, KeepaBasic>> {
  const out = new Map<string, KeepaBasic>()
  const key = process.env.KEEPA_API_KEY
  const valid = [...new Set(asins.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  if (!key || !valid.length) return out
  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100)
    const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${batch.join(',')}&stats=180&history=0`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
      if (!res.ok) continue
      const data = await res.json() as { products?: unknown[] }
      for (const raw of (Array.isArray(data.products) ? data.products : [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const product = raw as any
        const asin = String(product?.asin || '').toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(asin)) continue
        const csv = typeof product.imagesCSV === 'string' ? product.imagesCSV
          : (typeof product.image === 'string' ? product.image : null)
        const imageUrl = csv ? keepaImageUrl(csv.split(',')[0]) : null
        const ms = Number(product.monthlySold)
        const extras = parseKeepaExtras(product)
        out.set(asin, {
          asin,
          imageUrl,
          salesRank: extras.salesRank,
          salesRankCategory: extras.salesRankCategory,
          monthlySold: Number.isFinite(ms) && ms > 0 ? ms : null,
        })
      }
    } catch { /* skip this batch */ }
  }
  return out
}

/**
 * Keepa's `videos` array holds BOTH image-carousel videos and community/customer
 * videos from the listing's "Videos" section. We only want the carousel ones —
 * the brand/merchant clips a creator can trust and reuse. Each video has a
 * `creator` (Keepa `VideoCreatorType`), serialized as either a string name or a
 * numeric ordinal; community sources are Customer / Influencer / ThirdParty.
 *
 * Returns: true = ≥1 carousel video, false = `videos` present but none qualify,
 * null = no `videos` field on the response (unknown — Keepa returned nothing to
 * judge, so the caller must NOT overwrite a previously-known value).
 */
// VideoCreatorType ordinals (declaration order in Keepa's enum). Community =
// user/third-party contributed; everything else is a listing/brand video.
const COMMUNITY_CREATORS = new Set(['customer', 'influencer', 'thirdparty'])
const COMMUNITY_CREATOR_ORDINALS = new Set([1, 3, 5]) // Customer=1, Influencer=3, ThirdParty=5
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectCarouselVideo(videos: any): boolean | null {
  if (!Array.isArray(videos)) return null // field absent → unknown
  if (videos.length === 0) return false
  for (const v of videos) {
    if (!v || typeof v !== 'object') continue
    const c = (v as { creator?: unknown }).creator
    let community: boolean
    if (typeof c === 'number') community = COMMUNITY_CREATOR_ORDINALS.has(c)
    else if (typeof c === 'string') community = COMMUNITY_CREATORS.has(c.trim().toLowerCase())
    else community = false // unknown/missing creator → treat as a listing video
    if (!community) return true
  }
  return false
}

// ── Product "card" for the AMZ Finder Browse view ────────────────────────────
//
// A compact, presentation-ready snapshot of a single product — image, price +
// discount, rating, review count, recent monthly sales, and carousel-video
// count — for the Creator Connections catalog's representative products. One
// cached /product call (stats + rating + videos, no `offers`), same cheap path
// as fetchKeepaProductStats. Returns all-null (never throws) on any failure.

export interface KeepaProductCard {
  imageUrl: string | null
  priceNowCents: number | null
  priceWasCents: number | null
  discountPct: number | null
  /** 0–5 stars. */
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
  /** Number of brand/carousel (non-community) videos on the listing. */
  videoCount: number
  hasCarouselVideo: boolean | null
  /** Coarse Amazon product group (e.g. "Kitchen", "Health & Household") for
   *  revenue-by-category grouping. Null when Keepa doesn't return one. */
  category: string | null
  /** Variation parent ASIN (groups colour/size variants), or null. */
  parentAsin: string | null
  /** Current sales rank (lower = better-selling), or null. */
  salesRank: number | null
  /** 90-day average sales rank — for a rank-trend read. */
  salesRankAvg90: number | null
  /** The named category the sales rank is in (e.g. "Health & Household"). */
  salesRankCategory: string | null
  /** ISO date the product was first listed on Amazon (product age), or null. */
  listedSince: string | null
  /** Keepa token balance from this response, for the cron to pace on. */
  tokensLeft: number | null
}

export async function fetchKeepaProductCard(asin: string, domainId = KEEPA_DOMAIN_US): Promise<KeepaProductCard> {
  const empty: KeepaProductCard = { imageUrl: null, priceNowCents: null, priceWasCents: null, discountPct: null, rating: null, reviewCount: null, monthlySold: null, videoCount: 0, hasCarouselVideo: null, category: null, parentAsin: null, salesRank: null, salesRankAvg90: null, salesRankCategory: null, listedSince: null, tokensLeft: null }
  const key = process.env.KEEPA_API_KEY
  if (!key || !/^[A-Za-z0-9]{10}$/.test(asin)) return empty
  // stats=90 (current + 90-day avg for a discount read), rating=1 (current stars
  // + review count), videos=1 (carousel count), buybox=1 (the real "what you pay"
  // price — see PRICE_TYPE_BUY_BOX). history=0 keeps it light. No `offers` —
  // cached data, ~cheap.
  const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${asin}&stats=90&history=0&rating=1&videos=1&buybox=1`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return empty
    const data = await res.json() as { products?: unknown[]; tokensLeft?: number }
    const tokensLeft = Number.isFinite(data.tokensLeft as number) ? (data.tokensLeft as number) : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (Array.isArray(data.products) ? (data.products[0] as any) : null)
    if (!p) return { ...empty, tokensLeft }
    const stats = p.stats || {}
    // Buy Box first (what the shopper actually pays), then Amazon/New. This is the
    // fix for catalog prices reading lower than the live page on 3rd-party items.
    const priceNowCents = statPriceBuyBox(stats)
    const priceWasCents = statPriceBuyBox(stats, 'avg90') ?? statPriceBuyBox(stats, 'avg30')
    const discountPct = (priceNowCents != null && priceWasCents != null && priceWasCents > priceNowCents && priceWasCents > 0)
      ? Math.min(99, Math.max(1, Math.round(((priceWasCents - priceNowCents) / priceWasCents) * 100))) : null
    // Rating (×10) + review count live in the stats.current CSV array.
    const cur = Array.isArray(stats.current) ? stats.current : []
    const ratingRaw = Number(cur[KEEPA_CSV_RATING])
    const reviewsRaw = Number(cur[KEEPA_CSV_REVIEW_COUNT])
    const rating = Number.isFinite(ratingRaw) && ratingRaw > 0 ? Math.min(5, Math.round(ratingRaw) / 10) : null
    const reviewCount = Number.isFinite(reviewsRaw) && reviewsRaw >= 0 ? reviewsRaw : null
    const ms = Number(p.monthlySold)
    const monthlySold = Number.isFinite(ms) && ms > 0 ? ms : null
    const { count, has } = countCarouselVideos(p.videos)
    // Parent ASIN, sales rank + named category, coarse category, first-listed date
    // — all already in this response (no extra tokens).
    const extras = parseKeepaExtras(p)
    return { imageUrl: keepaProductImageUrl(p.images), priceNowCents, priceWasCents, discountPct, rating, reviewCount, monthlySold, videoCount: count, hasCarouselVideo: has, category: extras.category, parentAsin: extras.parentAsin, salesRank: extras.salesRank, salesRankAvg90: extras.salesRankAvg90, salesRankCategory: extras.salesRankCategory, listedSince: extras.listedSince, tokensLeft }
  } catch {
    return empty
  }
}

// ── Sales-rank history (Tier B: consistency sparkline) ───────────────────────
//
// The deep-dive's "is this a steady seller?" read. One cached /product call with
// history=1 gives us the full sales-rank time series (csv[3]); from it we draw a
// small sparkline and count how many recent months the product was actually
// ranked (a ranked month = it was selling that month). No `offers`, ~1 token —
// only fired on an explicit deep-dive open, so cost is bounded to intent.
export interface KeepaRankHistory {
  /** Downsampled RAW sales ranks, oldest→newest (lower = better-selling). */
  sparkline: number[]
  /** Distinct calendar months in the window that carried a real rank. */
  monthsTracked: number
  /** Ranked in ~every month of the window (a steady seller, not a flash). */
  consistent: boolean
  /** Amazon's "X+ bought/mo" badge, for the "~X/mo" line. Null when absent. */
  monthlySold: number | null
  tokensLeft: number | null
}

/** Parse Keepa's flat [minute, value, minute, value, …] history into points,
 *  dropping the -1 "no data" sentinels. Values are raw (rank or price). */
function parseKeepaCsvSeries(csvField: unknown): Array<{ t: number; v: number }> {
  if (!Array.isArray(csvField)) return []
  const out: Array<{ t: number; v: number }> = []
  for (let i = 0; i + 1 < csvField.length; i += 2) {
    const min = Number(csvField[i])
    const val = Number(csvField[i + 1])
    if (!Number.isFinite(min) || min <= 0) continue
    if (!Number.isFinite(val) || val < 0) continue // -1 = out of stock / unranked
    out.push({ t: (min + 21564000) * 60000, v: val })
  }
  return out
}

export async function fetchKeepaSalesRankHistory(asin: string, domainId = KEEPA_DOMAIN_US): Promise<KeepaRankHistory> {
  const empty: KeepaRankHistory = { sparkline: [], monthsTracked: 0, consistent: false, monthlySold: null, tokensLeft: null }
  const key = process.env.KEEPA_API_KEY
  if (!key || !/^[A-Za-z0-9]{10}$/.test(asin)) return empty
  // history=1 → full time series (we need csv[3]); days=365 bounds the payload to
  // the last year; stats=0 (we don't need the computed block here).
  const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${asin}&history=1&days=365`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return empty
    const data = await res.json() as { products?: unknown[]; tokensLeft?: number }
    const tokensLeft = Number.isFinite(data.tokensLeft as number) ? (data.tokensLeft as number) : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (Array.isArray(data.products) ? (data.products[0] as any) : null)
    if (!p) return { ...empty, tokensLeft }
    const series = parseKeepaCsvSeries(Array.isArray(p.csv) ? p.csv[KEEPA_CSV_SALES] : null)
    const ms = Number(p.monthlySold)
    const monthlySold = Number.isFinite(ms) && ms > 0 ? ms : null
    if (!series.length) return { ...empty, monthlySold, tokensLeft }

    // Keep the last 365 days and sort oldest→newest.
    const cutoff = series[series.length - 1].t - 365 * 24 * 60 * 60 * 1000
    const recent = series.filter(pt => pt.t >= cutoff).sort((a, b) => a.t - b.t)

    // Distinct months with a real rank sample = months the product was selling.
    const months = new Set<string>()
    for (const pt of recent) {
      const d = new Date(pt.t)
      months.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`)
    }
    const monthsTracked = months.size
    // "Consistent" = ranked in at least 5 of the last 6 months (steady, not a spike).
    const sixMoAgo = recent[recent.length - 1].t - 6 * 30.44 * 24 * 60 * 60 * 1000
    const recentMonths = new Set<string>()
    for (const pt of recent) {
      if (pt.t < sixMoAgo) continue
      const d = new Date(pt.t)
      recentMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth()}`)
    }
    const consistent = recentMonths.size >= 5

    // Downsample to ≤40 evenly-spaced points for a compact sparkline.
    const MAX = 40
    let sparkline: number[]
    if (recent.length <= MAX) sparkline = recent.map(pt => pt.v)
    else {
      sparkline = []
      const step = recent.length / MAX
      for (let i = 0; i < MAX; i++) sparkline.push(recent[Math.floor(i * step)].v)
    }
    return { sparkline, monthsTracked, consistent, monthlySold, tokensLeft }
  } catch {
    return empty
  }
}

// ── Sellers + marketplace availability (Tier C: competition read) ────────────
//
// The COSTLY tier: it uses Keepa's `&offers` param, which forces a live
// (multi-token) refresh instead of a cached read — so it is NEVER fired on a
// plain deep-dive open. It runs only when a creator explicitly asks ("Check
// sellers & marketplaces"), so the spend tracks a deliberate action, not a
// hover. Answers: how crowded is this listing (seller count), does Amazon /
// the brand sell it directly, and which major marketplaces carry it (for
// geo-routed international affiliate traffic).
export interface KeepaSellers {
  /** Number of live New-condition offers = sellers competing on the buy box. */
  sellerCount: number | null
  /** Amazon itself is one of the sellers (availabilityAmazon >= 0 or its seller id present). */
  soldByAmazon: boolean
  /** Exactly one seller — an exclusive listing, low competition. */
  singleSeller: boolean
  /** Marketplaces (of the curated major set) that currently carry this ASIN. */
  marketplaces: Array<{ code: string; label: string; available: boolean }>
  tokensLeft: number | null
}

export async function fetchKeepaSellers(asin: string, domainId = KEEPA_DOMAIN_US): Promise<KeepaSellers> {
  const empty: KeepaSellers = { sellerCount: null, soldByAmazon: false, singleSeller: false, marketplaces: [], tokensLeft: null }
  const key = process.env.KEEPA_API_KEY
  if (!key || !/^[A-Za-z0-9]{10}$/.test(asin)) return empty

  // 1) Offers on the primary marketplace — the seller/competition read. offers=20
  //    forces a live refresh (the costly bit); buybox=1 for the winning seller.
  let sellerCount: number | null = null
  let soldByAmazon = false
  let singleSeller = false
  let tokensLeft: number | null = null
  try {
    const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${domainId}&asin=${asin}&offers=20&stats=0&history=0&buybox=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
    if (res.ok) {
      const data = await res.json() as { products?: unknown[]; tokensLeft?: number }
      tokensLeft = Number.isFinite(data.tokensLeft as number) ? (data.tokensLeft as number) : null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (Array.isArray(data.products) ? (data.products[0] as any) : null)
      if (p) {
        // Prefer the CURRENTLY-live offers (liveOffersOrder indexes into offers);
        // fall back to the raw offers array length. Count distinct sellers.
        const offers = Array.isArray(p.offers) ? p.offers : []
        const liveIdx: number[] = Array.isArray(p.liveOffersOrder) ? p.liveOffersOrder : []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const live = liveIdx.length ? liveIdx.map((i: number) => offers[i]).filter(Boolean) : offers
        const sellerIds = new Set<string>()
        for (const o of live) {
          const sid = o && typeof o === 'object' ? String((o as { sellerId?: unknown }).sellerId || '') : ''
          if (sid) sellerIds.add(sid)
          if (sid === AMAZON_US_SELLER_ID) soldByAmazon = true
        }
        if (Number.isFinite(Number(p.availabilityAmazon)) && Number(p.availabilityAmazon) >= 0) soldByAmazon = true
        if (sellerIds.size > 0) { sellerCount = sellerIds.size; singleSeller = sellerIds.size === 1 }
        else if (live.length > 0) { sellerCount = live.length; singleSeller = live.length === 1 }
      }
    }
  } catch { /* offers read is best-effort */ }

  // 2) Marketplace availability — cheap CACHED existence probes (no offers) on the
  //    curated major set. A marketplace "has it" when Keepa returns the product
  //    with a title. ~1 token each; the small curated set bounds the total.
  const marketplaces: KeepaSellers['marketplaces'] = []
  await Promise.all(KEEPA_MARKETPLACES.map(async (mkt) => {
    try {
      const url = `${KEEPA_BASE}/product?key=${encodeURIComponent(key)}&domain=${mkt.domain}&asin=${asin}&stats=0&history=0`
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      let available = false
      if (res.ok) {
        const data = await res.json() as { products?: unknown[] }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = (Array.isArray(data.products) ? (data.products[0] as any) : null)
        available = !!(p && (typeof p.title === 'string' && p.title.trim().length > 0))
      }
      marketplaces.push({ code: mkt.code, label: mkt.label, available })
    } catch {
      marketplaces.push({ code: mkt.code, label: mkt.label, available: false })
    }
  }))
  // Stable order (Promise.all resolves out of order).
  marketplaces.sort((a, b) => KEEPA_MARKETPLACES.findIndex(m => m.code === a.code) - KEEPA_MARKETPLACES.findIndex(m => m.code === b.code))

  return { sellerCount, soldByAmazon, singleSeller, marketplaces, tokensLeft }
}

/** Like detectCarouselVideo but returns the COUNT of brand/carousel videos. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countCarouselVideos(videos: any): { count: number; has: boolean | null } {
  if (!Array.isArray(videos)) return { count: 0, has: null } // unknown
  let count = 0
  for (const v of videos) {
    if (!v || typeof v !== 'object') continue
    const c = (v as { creator?: unknown }).creator
    let community: boolean
    if (typeof c === 'number') community = COMMUNITY_CREATOR_ORDINALS.has(c)
    else if (typeof c === 'string') community = COMMUNITY_CREATORS.has(c.trim().toLowerCase())
    else community = false
    if (!community) count++
  }
  return { count, has: videos.length === 0 ? false : count > 0 }
}

/** Keepa product images are an Image[] with a large (`l`) filename token. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function keepaProductImageUrl(images: any): string | null {
  if (!Array.isArray(images) || images.length === 0) return null
  const first = images[0]
  let name = ''
  if (first && typeof first === 'object') name = String(first.l || first.m || '')
  else if (typeof first === 'string') name = first
  name = name.trim()
  if (!name) return null
  if (/^https?:\/\//i.test(name)) return name
  return `https://m.media-amazon.com/images/I/${name}`
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

  return { currentCents, avg90Cents, allTimeLowCents, pctBelowAvg90, quality, label, monthlySold: null, hasCarouselVideo: null, parentAsin: null, salesRank: null, salesRankAvg90: null, salesRankCategory: null, listedSince: null, category: null }
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

/**
 * The price a shopper actually pays: Buy Box first, then Amazon, then New.
 *
 * `which` picks the stats block — 'current' (default), 'avg90', 'avg30'. For
 * 'current' we also honor the top-level `stats.buyBoxPrice` field (Keepa exposes
 * the live Buy Box there when &buybox=1 is requested); for the averages we read
 * the Buy Box slot (index 18) out of the price array. Falls back to statPrice()
 * (Amazon → New) whenever no Buy Box price is available, so this is strictly an
 * improvement over reading the lowest New offer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function statPriceBuyBox(stats: any, which: 'current' | 'avg90' | 'avg30' = 'current'): number | null {
  if (!stats || typeof stats !== 'object') return null
  if (which === 'current') {
    const bbDirect = Number(stats.buyBoxPrice)
    if (Number.isFinite(bbDirect) && bbDirect >= 0) return bbDirect
  }
  const arr = stats[which]
  if (Array.isArray(arr)) {
    const bb = arr[PRICE_TYPE_BUY_BOX]
    if (Number.isFinite(bb) && (bb as number) >= 0) return bb as number
  }
  return statPrice(arr)
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
// ── Product Finder (Keepa /query) — the whole-catalogue search engine ─────────
//
// The /deal endpoint above only surfaces items that are CURRENTLY discounting.
// Product Finder is different: it searches the ENTIRE Amazon catalogue by any
// combination of attribute filters (price, rating, review count, sales rank,
// category, title keywords) and returns matching ASINs — deal or not. This is
// what powers "Amazon Product Research": a regular filterable catalogue browse,
// not a deals feed. It returns ASINs only (no product cards); the caller
// hydrates images/titles/prices separately (Creators API / product card).
//
// Docs: https://keepa.com/#!discuss/t/product-finder/407

export interface KeepaFinderFilters {
  /** Free-text match against the product title (Keepa does a contains match). */
  title?: string
  /** [minCents, maxCents] current Amazon/New price window (cents). */
  priceRangeCents?: [number | null, number | null]
  /** Minimum star rating, 0–5 (sent to Keepa as ×10). */
  minRating?: number
  /** Minimum number of reviews. */
  minReviews?: number
  /** Sales-rank ceiling — lower rank = better seller. e.g. 50000 = top sellers. */
  maxSalesRank?: number
  /** Keepa rootCategory id (top-level browse node) to constrain to. */
  rootCategory?: number
  /** How to order results. */
  sort?: 'salesRank' | 'reviews' | 'rating' | 'priceLow' | 'priceHigh'
  /** 0-based page. Keepa returns up to `perPage` ASINs per page. */
  page?: number
  perPage?: number
  domainId?: number
}

export interface KeepaFinderResult {
  asins: string[]
  tokensLeft: number | null
  /** Total matches Keepa reports for the selection, when present. */
  totalResults: number | null
  /** HTTP status of the /query call (0 = network/exception). Safe to surface. */
  status: number
  /** Keepa's error text on a non-OK response, truncated. Admin-diagnostic only —
   *  Product Finder 400s are query-validation messages, never billing. */
  error: string | null
}

const KEEPA_FINDER_SORT: Record<NonNullable<KeepaFinderFilters['sort']>, [string, 'asc' | 'desc']> = {
  salesRank: ['current_SALES', 'asc'],   // lowest rank first = best sellers
  reviews:   ['current_COUNT_REVIEWS', 'desc'],
  rating:    ['current_RATING', 'desc'],
  priceLow:  ['current_NEW', 'asc'],
  priceHigh: ['current_NEW', 'desc'],
}

/**
 * Search the whole Amazon catalogue by attribute filters. Returns matching
 * ASINs (up to `perPage`). Env-gated and fully defensive: with no key, a bad
 * response, or a thrown error it returns an empty result — never throws.
 */
export async function keepaProductFinder(filters: KeepaFinderFilters = {}): Promise<KeepaFinderResult> {
  const empty: KeepaFinderResult = { asins: [], tokensLeft: null, totalResults: null, status: 0, error: null }
  const key = process.env.KEEPA_API_KEY
  if (!key) return empty

  const domainId = filters.domainId ?? KEEPA_DOMAIN_US
  // Keepa Product Finder requires perPage in [50, 10000] — anything smaller is
  // rejected with invalidParameter ("perPage … too small"). 50 is the floor.
  const perPage = Math.min(10_000, Math.max(50, Math.floor(filters.perPage ?? 50)))
  const page = Math.max(0, Math.floor(filters.page ?? 0))

  // Keepa /query "selection" object. Every field is optional; omitting one drops
  // that constraint. Prices are cents; RATING is ×10 (45 = 4.5★). We deliberately
  // do NOT constrain productType — an over-tight type list silently zeroed out
  // otherwise-valid searches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selection: Record<string, any> = { page, perPage }

  const title = (filters.title || '').trim()
  if (title) selection.title = title

  if (filters.priceRangeCents) {
    const [lo, hi] = filters.priceRangeCents
    if (lo != null && Number.isFinite(lo) && lo > 0) selection.current_NEW_gte = Math.round(lo)
    if (hi != null && Number.isFinite(hi) && hi > 0) selection.current_NEW_lte = Math.round(hi)
  }
  if (filters.minRating != null && filters.minRating > 0) {
    selection.current_RATING_gte = Math.round(Math.min(5, filters.minRating) * 10)
  }
  if (filters.minReviews != null && filters.minReviews > 0) {
    selection.current_COUNT_REVIEWS_gte = Math.round(filters.minReviews)
  }
  if (filters.maxSalesRank != null && filters.maxSalesRank > 0) {
    // Exclude rank 0 (= no rank / unranked) so "top sellers" doesn't pull junk.
    selection.current_SALES_gte = 1
    selection.current_SALES_lte = Math.round(filters.maxSalesRank)
  }
  if (filters.rootCategory != null && filters.rootCategory > 0) {
    selection.rootCategory = Math.round(filters.rootCategory)
  }
  const sort = KEEPA_FINDER_SORT[filters.sort ?? 'salesRank']
  selection.sort = [sort]

  // Product Finder takes the selection as a URL-encoded GET param — the same
  // transport as the /deal feed that already works with this key. (A POST body
  // was rejected with 400.)
  const url = `${KEEPA_BASE}/query?key=${encodeURIComponent(key)}&domain=${domainId}&selection=${encodeURIComponent(JSON.stringify(selection))}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const data = await res.json().catch(() => ({})) as {
      asinList?: unknown; totalResults?: number; tokensLeft?: number; error?: unknown
    }
    const tokensLeft = Number.isFinite(data.tokensLeft as number) ? (data.tokensLeft as number) : null
    const totalResults = Number.isFinite(data.totalResults as number) ? (data.totalResults as number) : null
    if (!res.ok || data.error) {
      const errText = JSON.stringify(data.error ?? '').slice(0, 300)
      // Log server-side; Product Finder errors are query-validation, not billing.
      console.error('[keepa/query]', res.status, errText)
      return { ...empty, status: res.status, tokensLeft, totalResults, error: errText || null }
    }
    const asins = Array.isArray(data.asinList)
      ? (data.asinList as unknown[]).map(a => String(a || '').toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a))
      : []
    return { asins, tokensLeft, totalResults, status: res.status, error: null }
  } catch (e) {
    console.error('[keepa/query]', e instanceof Error ? e.message : e)
    return { ...empty, error: e instanceof Error ? e.message.slice(0, 200) : 'exception' }
  }
}

export function buildPriceContext(a: DealAssessment): string {
  // Relative framing only — no exact dollar amounts (those go stale the moment
  // the price moves and make an old post look wrong). Percentages are fine.
  if (a.quality === 'excellent') {
    return `Right now this is the lowest price we've tracked on this item.`
  }
  if (a.quality === 'genuine' && a.pctBelowAvg90 != null) {
    return `It's running about ${a.pctBelowAvg90}% below its usual price right now.`
  }
  if (a.quality === 'genuine') {
    return `It's well below its usual price right now.`
  }
  if (a.quality === 'fair') {
    return `It's running a little under its usual price right now.`
  }
  return ''
}

/**
 * A styled, self-contained "price check" HTML block for a generated post —
 * Now / Typical / All-time low, plus a little bar showing where today's price
 * sits in its historical range. Pure inline CSS (WordPress-safe, no JS). Trust +
 * SEO/AEO signal for "is this really a deal?". Never names a data source.
 *
 * Returns '' unless there's a current price plus at least a typical or all-time
 * low to compare against (otherwise there's nothing honest to show).
 */
export function buildPriceSnapshotHtml(a: DealAssessment): string {
  const now = a.currentCents
  const typical = a.avg90Cents
  const low = a.allTimeLowCents
  // Need enough to say something honest. No exact dollar amounts are rendered —
  // this is a RELATIVE "how strong is this deal" visual so the post doesn't go
  // stale when the price moves. Only the verdict + a position bar.
  if (a.quality == null && a.pctBelowAvg90 == null) return ''

  const headline = a.quality === 'excellent'
    ? 'This is the lowest price we&rsquo;ve tracked'
    : a.pctBelowAvg90 != null && a.pctBelowAvg90 >= 5
      ? `About ${a.pctBelowAvg90}% below its usual price`
      : a.quality === 'genuine'
        ? 'Well below its usual price'
        : 'A little under its usual price'

  // Bar from all-time low (left) to typical price (right) with a marker at where
  // today sits. Relative only — no values shown.
  let bar = ''
  if (now != null && low != null && typical != null && typical > low) {
    const pos = Math.max(0, Math.min(100, Math.round(((now - low) / (typical - low)) * 100)))
    bar = `<div style="margin-top:14px"><div style="position:relative;height:8px;border-radius:999px;background:linear-gradient(90deg,#16a34a,#e5e7eb)"><div style="position:absolute;top:-4px;left:${pos}%;transform:translateX(-50%);width:16px;height:16px;border-radius:999px;background:#fff;border:3px solid #16a34a;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-top:6px"><span>All-time low</span><span>Typical price</span></div></div>`
  }

  return `<div class="mvp-price-snapshot" style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:1.5em 0;background:#fafafa">
<div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-bottom:6px">Deal check</div>
<div style="font-size:18px;font-weight:700;color:#16a34a">${headline}</div>
${bar}
</div>`
}
