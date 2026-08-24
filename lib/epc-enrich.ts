// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared "what to write" for EPC Keepa enrichment, used by both the on-demand
// route (/api/epc/enrich) and the paced cron (/api/cron/enrich-epc-products) so
// the two stay in lockstep on which signals they persist. Given one product's
// Keepa basics (or null when Keepa had nothing), the existing image, and a
// timestamp, it returns the column patch. It ALWAYS stamps both enrichment
// timestamps so the row leaves the backlog even when Keepa returned nothing —
// that's what makes the enrichment loops terminate.

import type { KeepaBasic } from '@/services/keepa'

export function buildEpcPatch(
  b: KeepaBasic | undefined | null,
  existingImageUrl: string | null,
  at: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { enriched_at: at, deal_enriched_at: at }
  if (b) {
    if (b.monthlySold != null) patch.monthly_sold = b.monthlySold
    if (b.salesRank != null) patch.sales_rank = b.salesRank
    if (b.salesRankAvg90 != null) patch.sales_rank_avg90 = b.salesRankAvg90
    if (b.salesRankCategory) patch.sales_rank_category = b.salesRankCategory
    // Only fill the image if the scrape didn't already get one for this row.
    if (!existingImageUrl && b.imageUrl) patch.image_url = b.imageUrl
    // Price / deal / history signals (free — they ride the same stats response).
    if (b.priceNowCents != null) patch.price_now_cents = b.priceNowCents
    if (b.priceAvg90Cents != null) patch.price_avg_cents = b.priceAvg90Cents
    if (b.priceLowestCents != null) patch.price_lowest_cents = b.priceLowestCents
    if (b.discountPct != null) patch.discount_pct = b.discountPct
    if (b.dealQuality) patch.deal_quality = b.dealQuality
  }
  return patch
}
