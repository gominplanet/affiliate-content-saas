/**
 * GET /api/product/deep-dive?asin=<ASIN>
 *
 * The per-product research snapshot behind the deep-dive card: image, price vs
 * its 90-day typical and all-time low (the "deal check"), rating + reviews,
 * recent monthly sales, and carousel-video count — everything Keepa can tell a
 * creator about whether a product is worth promoting, in one on-demand call.
 *
 * Three cheap cached /product reads (no `offers`): stats, card, and the
 * sales-rank history (Tier B consistency sparkline), so one open ≈ 3 Keepa
 * tokens. Only fired on an explicit deep-dive open, so cost tracks intent.
 * Signed-in only; sanitized errors.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fetchKeepaProductStats, fetchKeepaProductCard, fetchKeepaSalesRankHistory, keepaConfigured } from '@/services/keepa'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'Enter a valid 10-character ASIN.' }, { status: 400 })
    if (!keepaConfigured()) return NextResponse.json({ error: 'Product data isn’t available right now. Please try again later.' }, { status: 503 })

    const [card, verdict, rankHistory] = await Promise.all([
      fetchKeepaProductCard(asin),
      fetchKeepaProductStats(asin),
      fetchKeepaSalesRankHistory(asin),
    ])

    const cents = (n: number | null) => (n == null ? null : Math.round(n) / 100)
    return NextResponse.json({
      ok: true,
      asin,
      imageUrl: card.imageUrl,
      priceNow: cents(card.priceNowCents ?? verdict.currentCents),
      typical: cents(verdict.avg90Cents),
      allTimeLow: cents(verdict.allTimeLowCents),
      pctBelowAvg90: verdict.pctBelowAvg90,
      quality: verdict.quality,          // excellent | genuine | fair | weak | null
      label: verdict.label,              // "All-time low" / "32% below its usual price"
      discountPct: card.discountPct,
      rating: card.rating,
      reviewCount: card.reviewCount,
      monthlySold: card.monthlySold ?? verdict.monthlySold,
      videoCount: card.videoCount,
      // Extra Keepa signals (parity with Oink).
      category: card.category ?? verdict.category,
      parentAsin: card.parentAsin ?? verdict.parentAsin,
      salesRank: card.salesRank ?? verdict.salesRank,
      salesRankAvg90: card.salesRankAvg90 ?? verdict.salesRankAvg90,
      salesRankCategory: card.salesRankCategory ?? verdict.salesRankCategory,
      listedSince: card.listedSince ?? verdict.listedSince,
      // Tier B: sales-rank history — sparkline + monthly-consistency read.
      rankSparkline: rankHistory.sparkline,
      monthsTracked: rankHistory.monthsTracked,
      sellsConsistently: rankHistory.consistent,
    })
  } catch (err) {
    console.error('[product/deep-dive]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't load this product just now. Please try again in a moment.") }, { status: 500 })
  }
}
