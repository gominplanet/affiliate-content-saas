/**
 * Creator Connections Intelligence — the decision layer over cc_campaign_catalog.
 *
 * Turns the raw catalog fields (commission, budget, budget_remaining,
 * available_slot, total_slot, price) into the signals a creator actually
 * decides on: is this brand paying out, how full is the campaign, and what's a
 * sale worth. All pure functions — no I/O — so they're trivial to test and can
 * run in a route or the client.
 *
 * "Does the brand pay out?" is derived, not scraped: a brand whose committed
 * budget is actually being CONSUMED (budget_remaining < budget across their
 * campaigns) is spending real money on creators. A brand that posts campaigns
 * but never spends is the red flag Logie-style tools call out.
 */

export interface BrandAgg {
  brandName: string
  totalCampaigns: number
  activeCampaigns: number
  /** Sum of budget across campaigns that HAVE a budget figure. */
  totalBudget: number
  /** Sum of budget_remaining across those same campaigns. */
  totalRemaining: number
  /** Whether ANY campaign for this brand carried a budget figure. Without it we
   *  can't judge payout behavior, so trust stays "unknown", not "risky". */
  hasBudgetData: boolean
  avgCommissionPct: number | null
}

export type TrustTier = 'reliable' | 'mixed' | 'risky' | 'unknown'

export interface BrandTrust {
  score: number        // 0-100
  tier: TrustTier
  /** Fraction of committed budget actually spent (0-1), or null when unknown. */
  spendRatio: number | null
  reasons: string[]    // short human bullets for the tooltip
}

/** Score how reliably a brand pays creators, from its aggregated campaign data.
 *  The spine of the signal is spend: budget consumed = money reaching creators. */
export function brandTrust(a: BrandAgg): BrandTrust {
  const reasons: string[] = []

  // No budget data anywhere → we genuinely can't tell. Neutral, labeled unknown.
  if (!a.hasBudgetData || a.totalBudget <= 0) {
    return {
      score: 50,
      tier: 'unknown',
      spendRatio: null,
      reasons: ['No budget data yet — payout reliability unknown'],
    }
  }

  const used = Math.max(0, a.totalBudget - a.totalRemaining)
  const spendRatio = a.totalBudget > 0 ? Math.min(1, used / a.totalBudget) : 0

  let score = 50
  if (used > 0) { score += 22; reasons.push('Budget is actually being spent (pays creators)') }
  else { score -= 28; reasons.push('Budget posted but none spent yet') }

  if (a.activeCampaigns > 0) { score += 14; reasons.push(`${a.activeCampaigns} active campaign${a.activeCampaigns > 1 ? 's' : ''}`) }
  else { score -= 8; reasons.push('No campaigns running right now') }

  if (a.totalBudget >= 5000) { score += 10; reasons.push('Serious total spend committed') }
  else if (a.totalBudget >= 1000) { score += 4 }

  if (a.totalCampaigns >= 3) { score += 5; reasons.push(`${a.totalCampaigns} campaigns on record`) }

  // Very high spend ratio on an established brand = consistently funding through.
  if (spendRatio >= 0.5 && a.totalCampaigns >= 2) { score += 6 }

  score = Math.max(0, Math.min(100, score))
  const tier: TrustTier = score >= 65 ? 'reliable' : score >= 42 ? 'mixed' : 'risky'
  return { score, tier, spendRatio, reasons }
}

export interface Fullness {
  spotsLeft: number | null
  totalSlots: number | null
  pctFilled: number | null   // 0-100
  isFull: boolean
}

/** Campaign fullness from slot counts. Every CC campaign has a fixed cap
 *  (commonly 800); once full you can't earn the bounty even if you post. */
export function campaignFullness(availableSlot: number | null | undefined, totalSlot: number | null | undefined): Fullness {
  const avail = availableSlot != null && isFinite(availableSlot) ? Math.max(0, Math.trunc(availableSlot)) : null
  const total = totalSlot != null && isFinite(totalSlot) && totalSlot > 0 ? Math.trunc(totalSlot) : null
  const pctFilled = avail != null && total != null ? Math.max(0, Math.min(100, Math.round(((total - avail) / total) * 100))) : null
  const isFull = avail != null ? avail <= 0 : false
  return { spotsLeft: avail, totalSlots: total, pctFilled, isFull }
}

/** Estimated dollars earned per sale from commission % and current price.
 *  priceCents is the enriched cc_campaign_catalog.price_now_cents. */
export function estPerSale(commissionPct: number | null | undefined, priceCents: number | null | undefined): number | null {
  if (commissionPct == null || priceCents == null || priceCents <= 0) return null
  return (priceCents / 100) * (commissionPct / 100)
}

/** Whole-days until a campaign ends (0 = ends today, negative = past). */
export function daysUntil(endsAt: string | null | undefined, now = new Date()): number | null {
  if (!endsAt) return null
  const end = new Date(endsAt + 'T00:00:00Z')
  if (isNaN(end.getTime())) return null
  const ms = end.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round(ms / 86_400_000)
}

/** A single ranking score so the best opportunities float up: reward high
 *  $/sale, a paying brand, and open spots; penalize near-full / near-expiry. */
export function opportunityScore(input: {
  perSale: number | null
  commissionPct: number | null
  trust: BrandTrust
  fullness: Fullness
  daysLeft: number | null
  monthlySold: number | null
}): number {
  let s = 0
  if (input.perSale != null) s += Math.min(40, input.perSale * 4)      // $10/sale → 40
  else if (input.commissionPct != null) s += Math.min(20, input.commissionPct)
  s += (input.trust.score - 50) * 0.5                                   // ±25
  if (input.fullness.isFull) s -= 30
  else if (input.fullness.pctFilled != null) s -= input.fullness.pctFilled * 0.15  // fuller = worse
  if (input.daysLeft != null) {
    if (input.daysLeft <= 1) s -= 8
    else if (input.daysLeft >= 7) s += 4
  }
  if (input.monthlySold != null) s += Math.min(15, Math.log10(Math.max(1, input.monthlySold)) * 5) // demand
  return Math.round(s * 10) / 10
}
