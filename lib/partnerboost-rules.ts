// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The MVP Finder rulebook for PartnerBoost. Same philosophy as the Amazon and
// Levanta rulebooks — sweep the brands you've JOINED, keep only products worth a
// review, rank the survivors, hide the thresholds — but PartnerBoost exposes far
// less signal than Levanta: the datafeed gives a product's PRICE, and the
// Monetization API gives the BRAND's commission. There is NO rating, review
// count, EPC, or sales figure. So the rulebook gates on commission + price +
// category and ranks by estimated commission dollars per sale. Honest about what
// the data supports; don't pretend to demand/quality signals we don't have.
//
// SINGLE SOURCE OF TRUTH — tweak the numbers here; the /partnerboost Finder sends
// them to the sweep route at search time.

export interface PbRules {
  /** Minimum brand commission % (parsed from the Monetization API's comm_rate). */
  minCommissionPct: number
  /** Price band — cheap items don't repay a review; luxury ones stall. */
  minPrice: number
  maxPrice: number
  /** In WIDE, let flat-CPA brands (a $ payout, no %) through if the payout clears this. */
  minFlatPayout: number
  /** Category / title patterns MVP never recommends. */
  avoidPatterns: string[]
}

const AVOID_PATTERNS: string[] = [
  // supplements (incl. common single-ingredient ones)
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

/** FOCUS — strict, recommended. */
export const PB_RULES: PbRules = {
  minCommissionPct: 10,
  minPrice: 25,
  maxPrice: 600,
  minFlatPayout: 8,
  avoidPatterns: AVOID_PATTERNS,
}

/** WIDE — looser net: lower commission + price floor, and flat-CPA brands allowed. */
export const PB_RULES_WIDE: PbRules = {
  ...PB_RULES,
  minCommissionPct: 5,
  minPrice: 15,
  maxPrice: 1000,
  minFlatPayout: 3,
}

export type PbRuleMode = 'focus' | 'wide'
export function pbRules(mode: PbRuleMode): PbRules {
  return mode === 'wide' ? PB_RULES_WIDE : PB_RULES
}

/**
 * Parse a percent from a PartnerBoost comm_rate string. Handles "5%",
 * "8.00%", "Up to 12%", "5% - 12%" (takes the highest). Returns null when the
 * rate carries no percent (e.g. a flat "$5.00" CPA payout).
 */
export function parseCommissionPct(commRate: string | null | undefined): number | null {
  if (!commRate) return null
  const pcts = String(commRate).match(/(\d+(?:\.\d+)?)\s*%/g)
  if (!pcts || pcts.length === 0) return null
  const nums = pcts.map((s) => parseFloat(s)).filter((n) => Number.isFinite(n))
  return nums.length ? Math.max(...nums) : null
}

/** Parse a flat $ payout from avg_payout / a "$5.00" comm_rate. */
export function parseDollars(v: string | null | undefined): number | null {
  if (!v) return null
  const m = String(v).match(/(\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

/** One product flowing through the Finder (normalized from a PB datafeed row). */
export interface PbCandidate {
  key: string            // dedupe + save key: sku, else the product URL
  name: string
  priceNum: number | null
  price: string | null   // original string, passed to the generate route
  commissionPct: number | null
  flatPayout: number | null
  image: string | null
  url: string
  category: string | null
  brandName: string | null
  brandCategories: string | null
  network: string
  sku: string | null
  trackingUrl: string       // product's own datafeed tracking link (may be '')
  brandTrackingUrl: string  // brand deep-link base
}

export interface ScoredPbMatch extends PbCandidate {
  score: number
  perSale: number | null
}

/** True when a product/brand hits a hard NO category (product + brand text). */
export function isAvoidedPb(c: Pick<PbCandidate, 'name' | 'category' | 'brandCategories'>, rules: PbRules): boolean {
  const hay = `${c.name || ''} ${c.category || ''} ${c.brandCategories || ''}`.toLowerCase()
  return rules.avoidPatterns.some((p) => hay.includes(p))
}

/** Brand-level gate — run BEFORE fetching a brand's products (saves API calls). */
export function brandPassesPb(
  b: { commissionPct: number | null; flatPayout: number | null },
  rules: PbRules,
): boolean {
  if (b.commissionPct != null) return b.commissionPct >= rules.minCommissionPct
  // No percent → flat-CPA brand. Only WIDE lets these through, via minFlatPayout.
  return b.flatPayout != null && b.flatPayout >= rules.minFlatPayout
}

/** Product-level gate. */
export function passesPbGates(c: PbCandidate, rules: PbRules): boolean {
  if (!c.name || !c.url) return false
  if (isAvoidedPb(c, rules)) return false
  if (c.priceNum == null || c.priceNum < rules.minPrice || c.priceNum > rules.maxPrice) return false
  return true
}

/**
 * Rank by estimated commission dollars per sale — the only ROI signal PB gives
 * us. Percent brands: price × commission%. Flat-CPA brands: the payout itself.
 */
export function scorePb(c: PbCandidate): ScoredPbMatch {
  const price = c.priceNum ?? 0
  const perSale = c.commissionPct != null && price > 0
    ? Math.round(price * (c.commissionPct / 100) * 100) / 100
    : (c.flatPayout ?? null)
  const score = (perSale ?? 0) * 10 + (c.commissionPct ?? 0)
  return { ...c, perSale, score: Math.round(score * 10) / 10 }
}
