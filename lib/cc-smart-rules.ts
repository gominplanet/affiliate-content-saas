// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The MVP Smart Scan rulebook — Seb's PROVEN Creator Connections criteria,
// baked in as product opinion (deliberately NOT a user-facing settings form;
// that's the whole differentiation vs generic filter tools like ViralVue's
// Auto Research: MVP tells you which campaigns are worth your time).
//
// Two routes per match, both first-class:
//   1. MESSAGE THE BRAND (free-product / collab route) — existing outreach flow.
//   2. BUY TO REVIEW (MVP's preferred route) — invest in the product, make the
//      video + post, earn the commission back through the campaign. The
//      break-even math below makes that decision concrete.
//
// This module is the SINGLE SOURCE OF TRUTH: the /epc Smart Scan sends this
// rules object to SCOUT (the extension applies whatever it receives — no
// duplicated constants to drift), and the app re-applies gates + scoring on
// what comes back (defense in depth against a stale extension).

/** Rules applied by SCOUT while scanning. Plain JSON — crosses the extension
 *  message boundary as-is. */
export interface CcSmartRules {
  /** Affiliate+ hard gates */
  minCommissionPct: number
  minDaysLeft: number
  minPrice: number
  maxPrice: number
  minMonthlySales: number
  minRating: number
  /** Sponsored-tab hard gates */
  minEpc: number
  /** Global floor — "never under $25", stricter than any tab minimum. */
  hardFloorPrice: number
  /** The product page MUST have a creator-video carousel — that's the traffic
   *  mechanism the whole play depends on. No carousel, no match. */
  requireCarousel: boolean
  /** Amazon-throttle safety: deep-check at most this many candidates/scan. */
  deepCheckCap: number
  /** Case-insensitive substrings that disqualify a campaign by name/brand/
   *  breadcrumb — the "never" list. */
  avoidPatterns: string[]
}

export const CC_SMART_RULES: CcSmartRules = {
  minCommissionPct: 15,
  minDaysLeft: 90,
  // Floor lowered 30→20 (2026-08) — $30 cut too many viable niches (e.g. solar
  // lights). hardFloorPrice matches so the effective gate is a clean $20.
  minPrice: 20,
  maxPrice: 800,
  minMonthlySales: 100,
  minRating: 3,
  minEpc: 0.25,
  hardFloorPrice: 20,
  requireCarousel: true,
  deepCheckCap: 40,
  // never: supplements, food, pharmacy, clothing
  avoidPatterns: [
    // supplements
    'supplement', 'vitamin', 'gummies', 'protein powder', 'creatine', 'collagen',
    'probiotic', 'pre-workout', 'preworkout', 'multivitamin', 'omega-3', 'omega 3',
    // food / grocery
    'grocery', 'gourmet food', 'snack', 'coffee', 'chocolate', 'candy', 'sauce',
    'seasoning', 'beverage', 'drink mix', 'tea bags', 'protein bar', 'cereal',
    // pharmacy / meds
    'pharmacy', 'medicine', 'ibuprofen', 'acetaminophen', 'antacid', 'allergy relief',
    'cough', 'cold & flu', 'first aid', 'band-aid', 'health care > medic',
    // clothing
    'clothing', 'apparel', 't-shirt', 'tshirt', 'hoodie', 'jeans', 'dress',
    'sneaker', 'boots', 'sandals', 'jacket', 'sweater', 'leggings', 'underwear',
    'socks', 'bra ', 'shoes & jewelry',
  ],
}

/**
 * WIDE preset — the "less focused" mode of the MVP Finder's Campaigns ON. Same
 * hard NO categories (supplements/food/pharmacy/clothing stay banned — those are
 * never good picks), but every numeric gate is loosened so more campaigns clear:
 * lower commission floor, shorter runway, wider price band, lower demand + rating
 * bars, and no carousel requirement. Still returns real, viable campaigns — just
 * a broader net than MVP Focus (which follows the full Profitability Rules).
 * The UI NEVER names these thresholds; it only labels the two modes.
 */
export const CC_SMART_RULES_WIDE: CcSmartRules = {
  ...CC_SMART_RULES,
  minCommissionPct: 10,
  minDaysLeft: 45,
  minPrice: 15,
  maxPrice: 1500,
  minMonthlySales: 100,
  minRating: 3,
  hardFloorPrice: 15,
  requireCarousel: true,
}

/** The two Campaigns-ON presets, keyed by the UI toggle. */
export type CampaignRuleMode = 'focus' | 'wide'
export function campaignRules(mode: CampaignRuleMode): CcSmartRules {
  return mode === 'wide' ? CC_SMART_RULES_WIDE : CC_SMART_RULES
}

/**
 * ONSITE rulebook — the "Campaigns OFF" mode of the AMZ Product Finder: SCOUT
 * searches Amazon directly (no Creator Connections) for products worth the
 * buy-to-review investment. Every result is MVP-APPROVED against these gates:
 */
export interface OnsiteRules {
  minPrice: number
  minRating: number
  minReviews: number
  minMonthlySales: number
  requireCarousel: boolean
}
export const ONSITE_RULES: OnsiteRules = {
  minPrice: 25,          // never below $25
  minRating: 3.8,
  minReviews: 50,
  minMonthlySales: 200,
  requireCarousel: true, // at least 1 video in the carousel
}

export type AmzMarketplace = 'us' | 'ca' | 'uk' | 'au'
export const AMZ_MARKETPLACES: { id: AmzMarketplace; label: string; host: string }[] = [
  { id: 'us', label: 'Amazon US', host: 'www.amazon.com' },
  { id: 'ca', label: 'Amazon Canada', host: 'www.amazon.ca' },
  { id: 'uk', label: 'Amazon UK', host: 'www.amazon.co.uk' },
  { id: 'au', label: 'Amazon Australia', host: 'www.amazon.com.au' },
]

/** One scanned + deep-checked campaign coming back from SCOUT. */
export interface SmartScanMatch {
  asin: string | null
  campaignName: string | null
  brand: string | null
  detailsUrl: string | null
  campaignId: string | null
  image: string | null
  commissionPct: number | null
  endsAt: string | null
  daysLeft: number | null
  price: number | null
  monthlySales: number | null
  rating: number | null
  /** 'top' = hero media gallery (best), 'bottom' = related-videos strip, 'none' */
  carouselPos: 'top' | 'bottom' | 'none' | null
  hasVideo: boolean
  /** Breadcrumb / category text read off the product page (avoid-list check). */
  crumbs: string | null
}

export interface SmartScanStats {
  scannedOnCard: number
  passedOnCard: number
  deepChecked: number
  blocked?: boolean // Amazon interstitial hit — scan stopped early
  /** Why deep-checked candidates dropped — distinguishes strict-rules outcomes
   *  (spread across sales/carousel/price) from extraction bugs (everything
   *  piling into `unreadable`). Labels stay GENERIC in the UI (no thresholds). */
  drops?: { unreadable: number; price: number; sales: number; rating: number; carousel: number; category: number }
}

export interface ScoredMatch extends SmartScanMatch {
  score: number
  reasons: string[]
  /** Buy-to-review economics (null when price/commission unknown). */
  roi: { costUsd: number; perSaleUsd: number; breakEvenSales: number } | null
}

/** Buy-to-review break-even: sales needed for commission to repay the product
 *  cost. Independent of price when commission is a % of the same product —
 *  ceil(100 / pct) — but we surface the $ figures because that's how a human
 *  decides ("$89 in, $22 back per sale"). */
export function buyToReviewRoi(price: number | null, commissionPct: number | null) {
  if (price == null || commissionPct == null || commissionPct <= 0) return null
  const perSaleUsd = Math.round(price * commissionPct) / 100
  return { costUsd: price, perSaleUsd, breakEvenSales: Math.ceil(100 / commissionPct) }
}

export function hitsAvoidList(m: Pick<SmartScanMatch, 'campaignName' | 'brand' | 'crumbs'>, rules: CcSmartRules): string | null {
  const hay = `${m.campaignName || ''} ${m.brand || ''} ${m.crumbs || ''}`.toLowerCase()
  for (const p of rules.avoidPatterns) if (hay.includes(p)) return p
  return null
}

/** Re-apply the hard gates app-side (SCOUT already gated; this protects against
 *  an outdated extension build). Lenient ONLY where SCOUT could not read a
 *  value the card/page sometimes hides (rating) — never on the carousel rule. */
export function passesGates(m: SmartScanMatch, rules: CcSmartRules): boolean {
  if (m.commissionPct != null && m.commissionPct < rules.minCommissionPct) return false
  if (m.daysLeft != null && m.daysLeft < rules.minDaysLeft) return false
  if (m.price != null && (m.price < Math.max(rules.minPrice, rules.hardFloorPrice) || m.price > rules.maxPrice)) return false
  if (m.price == null) return false // price unknown after a deep-check = couldn't read the page; don't recommend blind
  if (m.monthlySales != null && m.monthlySales < rules.minMonthlySales) return false
  if (m.rating != null && m.rating < rules.minRating) return false
  if (rules.requireCarousel && m.carouselPos !== 'top' && m.carouselPos !== 'bottom') return false
  if (hitsAvoidList(m, rules)) return false
  return true
}

/** Rank passers. Tie-breaker order per the rulebook: carousel placement first
 *  (top slot = your review can actually surface on the product page), then
 *  commission, runway, and demand. */
export function scoreMatch(m: SmartScanMatch, rules: CcSmartRules): ScoredMatch {
  let score = 50
  const reasons: string[] = []

  if (m.carouselPos === 'top') { score += 20; reasons.push('video carousel in the hero gallery — prime slot') }
  else if (m.carouselPos === 'bottom') { score += 8; reasons.push('video carousel on the page') }

  if (m.commissionPct != null) {
    score += Math.min(20, (m.commissionPct - rules.minCommissionPct) * 2)
    reasons.push(`${m.commissionPct}% commission`)
  }
  if (m.daysLeft != null) {
    if (m.daysLeft >= 180) { score += 8; reasons.push(`${m.daysLeft} days left — long runway`) }
    else reasons.push(`${m.daysLeft} days left`)
  }
  if (m.monthlySales != null) {
    if (m.monthlySales >= 1500) { score += 10; reasons.push(`${m.monthlySales.toLocaleString()}+ sold/mo — heavy demand`) }
    else if (m.monthlySales >= 500) { score += 5; reasons.push(`${m.monthlySales.toLocaleString()} sold/mo`) }
    else reasons.push(`${m.monthlySales} sold/mo`)
  }
  if (m.price != null) {
    if (m.price >= 60 && m.price <= 200) score += 4 // sweet spot inside the band
    reasons.push(`$${m.price.toFixed(0)}`)
  }
  if (m.rating != null) reasons.push(`★${m.rating.toFixed(1)}`)

  const roi = buyToReviewRoi(m.price, m.commissionPct)
  return { ...m, score: Math.round(Math.min(100, score)), reasons, roi }
}
