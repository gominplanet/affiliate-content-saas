// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The MVP Finder rulebook for Levanta (Amazon Creator network). Same philosophy
// as the Amazon Creator-Connections rulebook (lib/cc-smart-rules.ts): sweep the
// creator's partnered brands, keep ONLY products worth a review, rank the
// survivors, and never show the thresholds in the UI.
//
// Why Levanta gets its OWN file (not the CC one): Levanta's Creator API returns
// signals CC never did — a real commission %, price, rating, review count, and
// `platformEpc` (Levanta's own modeled earnings-per-click). That last one is the
// star: it's the network telling us how much a click is worth, so we gate on it
// AND make it the ranking driver. Levanta gives us NO monthly-sales figure and
// no way to see the video carousel from the API — review count + EPC stand in
// for demand; the carousel check is a possible SCOUT v2 add-on, not needed here.
//
// This is the SINGLE SOURCE OF TRUTH. Tweak the numbers here — the /levanta
// Finder sends them to the sweep route at search time; no other change needed.

export interface LevantaRules {
  /** Minimum commission % offered by the brand (Levanta's headline value). */
  minCommissionPct: number
  /** Price band — cheap items don't clear a review's effort; luxury ones stall. */
  minPrice: number
  maxPrice: number
  /** Star-rating floor (product quality → your credibility). */
  minRating: number
  /** Review-count floor — the demand proxy Levanta gives us in place of sales. */
  minReviews: number
  /** Platform-EPC floor ($) — Levanta's own modeled earnings-per-click. */
  minEpc: number
  /** Skip out-of-stock products (nothing to earn on a dead listing). */
  requireInStock: boolean
  /** Category / title patterns MVP never recommends (compliance + conversion). */
  avoidPatterns: string[]
}

// The hard NO categories are the same across Focus and Wide — supplements, food,
// pharmacy and clothing are never good review picks (compliance, returns, sizing).
const AVOID_PATTERNS: string[] = [
  // supplements (incl. common single-ingredient supplements Levanta surfaces —
  // "Magnesium Complex" etc. slipped the earlier list)
  'supplement', 'vitamin', 'gummies', 'protein powder', 'creatine', 'collagen',
  'probiotic', 'pre-workout', 'preworkout', 'multivitamin', 'omega-3', 'omega 3',
  'magnesium', 'melatonin', 'ashwagandha', 'turmeric', 'elderberry', 'fish oil',
  'electrolyte', 'capsule', 'softgel', 'nootropic',
  // food / grocery
  'grocery', 'gourmet food', 'snack', 'coffee', 'chocolate', 'candy', 'sauce',
  'seasoning', 'beverage', 'drink mix', 'tea bags', 'protein bar', 'cereal',
  // pharmacy / meds
  'pharmacy', 'medicine', 'ibuprofen', 'acetaminophen', 'antacid', 'allergy relief',
  'cough', 'cold & flu', 'first aid', 'band-aid',
  // clothing
  'clothing', 'apparel', 't-shirt', 'tshirt', 'hoodie', 'jeans', 'dress',
  'sneaker', 'boots', 'sandals', 'jacket', 'sweater', 'leggings', 'underwear',
  'socks', 'bra ', 'shoes & jewelry',
]

/**
 * MVP FOCUS — the strict, recommended preset. Mirrors the Amazon Focus numbers
 * (price band, rating, review demand) plus a real EPC floor from Levanta.
 */
export const LEVANTA_RULES: LevantaRules = {
  minCommissionPct: 10,
  minPrice: 30,
  maxPrice: 900,
  minRating: 3.5,
  minReviews: 50,
  minEpc: 0.30,
  requireInStock: true,
  avoidPatterns: AVOID_PATTERNS,
}

/**
 * WIDE — the looser net. Every numeric gate relaxes (lower commission, EPC,
 * rating and demand bars; wider price band) so more products clear. Still real,
 * viable picks — just a broader sweep than Focus (which follows the full MVP
 * Profitability Rules). Same hard NO categories. The UI never names these.
 */
export const LEVANTA_RULES_WIDE: LevantaRules = {
  ...LEVANTA_RULES,
  minCommissionPct: 7,
  minPrice: 15,
  maxPrice: 1500,
  minRating: 3,
  minReviews: 20,
  minEpc: 0.15,
}

/** The two presets, keyed by the UI toggle. */
export type LevantaRuleMode = 'focus' | 'wide'
export function levantaRules(mode: LevantaRuleMode): LevantaRules {
  return mode === 'wide' ? LEVANTA_RULES_WIDE : LEVANTA_RULES
}

/** One product as it flows through the Finder (normalized from LevantaProduct). */
export interface LevantaCandidate {
  asin: string
  title: string
  price: number | null
  commission: number | null // percent, e.g. 12
  rating: number | null
  ratingsTotal: number | null
  platformEpc: number | null // $/click, Levanta's model
  category: string | null
  inStock: boolean
  image: string | null
  brandId: string | null
  brandName: string | null
  marketplace: string
}

export interface ScoredLevantaMatch extends LevantaCandidate {
  score: number
  /** Estimated commission dollars per sale (price × commission%). */
  perSale: number | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** True when a product violates a hard NO category (title or category match). */
export function isAvoided(c: Pick<LevantaCandidate, 'title' | 'category'>, rules: LevantaRules): boolean {
  const hay = `${c.title || ''} ${c.category || ''}`.toLowerCase()
  return rules.avoidPatterns.some((p) => hay.includes(p))
}

/** All gates must pass. Missing signals fail closed on the ones MVP won't guess. */
export function passesLevantaGates(c: LevantaCandidate, rules: LevantaRules): boolean {
  if (rules.requireInStock && !c.inStock) return false
  if (isAvoided(c, rules)) return false

  const comm = num(c.commission)
  if (comm == null || comm < rules.minCommissionPct) return false

  const price = num(c.price)
  if (price == null || price < rules.minPrice || price > rules.maxPrice) return false

  // Rating + review demand: only fail when the value EXISTS and is under bar —
  // Levanta occasionally omits rating on a fresh listing; don't punish silence,
  // but a present-and-low value is a real signal to drop.
  const rating = num(c.rating)
  if (rating != null && rating < rules.minRating) return false
  const reviews = num(c.ratingsTotal)
  if (reviews != null && reviews < rules.minReviews) return false

  // EPC is Levanta's own earnings model — when present it's the strongest gate.
  const epc = num(c.platformEpc)
  if (epc != null && epc < rules.minEpc) return false

  return true
}

/**
 * Rank driver — EPC-forward. Levanta hands us a modeled $/click, so we lean on
 * it hardest, then reward commission dollars per sale, then demand and quality.
 * A product with no EPC still scores off its $/sale + demand so it isn't buried.
 */
export function scoreLevanta(c: LevantaCandidate): ScoredLevantaMatch {
  const price = num(c.price) ?? 0
  const comm = num(c.commission) ?? 0
  const perSale = price > 0 && comm > 0 ? Math.round(price * (comm / 100) * 100) / 100 : null
  const epc = num(c.platformEpc)
  const reviews = num(c.ratingsTotal) ?? 0
  const rating = num(c.rating) ?? 0

  const score =
    (epc != null ? epc * 1000 : (perSale ?? 0) * 20) + // EPC dominates; fall back to $/sale
    (perSale ?? 0) * 3 +                                // commission dollars per sale
    Math.min(reviews, 10_000) / 200 +                  // demand, capped so a mega-review item can't run away
    rating * 4                                          // quality nudge

  return { ...c, perSale, score: Math.round(score * 10) / 10 }
}
