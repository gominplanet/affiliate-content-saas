/**
 * GET /api/cron/enrich-cc-catalog
 *
 * Enriches the shared Creator Connections catalog (cc_campaign_catalog) with the
 * PRODUCT signals the AMZ Finder "Browse all" view shows alongside campaign
 * economics — image, recent sales, rating, review count, video count, price +
 * discount — for each campaign's representative product (rep_asin = asins[1]).
 *
 * SHARED + paced, exactly like refresh-deal-radar: one operator Keepa key, one
 * cached /product call per DISTINCT representative product (no `offers`, ~cheap),
 * and every campaign sharing that product is updated in a single pass. Cost
 * scales with distinct products × cadence, never with user count.
 *
 * Auth: Vercel cron `Authorization: Bearer ${CRON_SECRET}`.
 * Env-gated: KEEPA_API_KEY unset ⇒ {skipped}, touches nothing.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaProductCard, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Max DISTINCT products to enrich per run (env-tunable). Kept modest so one run
 *  stays within the token rate + timeout; the rest catch up next run. */
const ENRICH_MAX = Math.max(0, Number(process.env.CC_ENRICH_MAX) || 80)
/** Re-verify a product at most this often. */
const VERIFY_TTL_HOURS = 24 * 7
/** Stop before the balance runs dry (shared with the Deal Radar sweep). */
const MIN_TOKENS_TO_CONTINUE = 40

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) return NextResponse.json({ ok: true, skipped: 'keepa_unconfigured' })
  if (ENRICH_MAX === 0) return NextResponse.json({ ok: true, skipped: 'disabled' })

  const startedAt = Date.now()
  const deadline = startedAt + 250_000 // stay under maxDuration
  const admin = createAdminClient()
  const staleBefore = new Date(Date.now() - VERIFY_TTL_HOURS * 3_600_000).toISOString()

  // Rows needing enrichment — never verified, or verified > TTL ago. Order
  // least-recently-verified first so coverage spreads evenly; over-fetch so that
  // after de-duping by rep_asin we still have a full batch of DISTINCT products.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('cc_campaign_catalog')
    .select('rep_asin, product_verified_at')
    .not('rep_asin', 'is', null)
    .or(`product_verified_at.is.null,product_verified_at.lt.${staleBefore}`)
    .order('product_verified_at', { ascending: true, nullsFirst: true })
    .limit(ENRICH_MAX * 8)
  if (error) return NextResponse.json({ ok: false, error: 'catalog-unavailable' }, { status: 200 })

  // Distinct representative ASINs, in the order first seen (least-verified first).
  const seen = new Set<string>()
  const asins: string[] = []
  for (const r of (data ?? []) as Array<{ rep_asin: string | null }>) {
    const a = (r.rep_asin || '').toUpperCase()
    if (a && !seen.has(a)) { seen.add(a); asins.push(r.rep_asin as string) }
    if (asins.length >= ENRICH_MAX) break
  }
  if (asins.length === 0) return NextResponse.json({ ok: true, enriched: 0, note: 'nothing due' })

  let enriched = 0
  let tokensLeft: number | null = null
  const nowIso = () => new Date().toISOString()
  for (const asin of asins) {
    if (Date.now() > deadline) break
    if (tokensLeft != null && tokensLeft < MIN_TOKENS_TO_CONTINUE) break
    const c = await fetchKeepaProductCard(asin)
    tokensLeft = c.tokensLeft ?? tokensLeft
    // Update EVERY campaign sharing this representative product in one write.
    // product_verified_at is stamped even on a null card so we don't re-hammer a
    // product with no usable data each run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('cc_campaign_catalog').update({
      image_url: c.imageUrl,
      price_now_cents: c.priceNowCents,
      price_was_cents: c.priceWasCents,
      discount_pct: c.discountPct,
      rating: c.rating,
      review_count: c.reviewCount,
      monthly_sold: c.monthlySold,
      video_count: c.videoCount,
      product_verified_at: nowIso(),
    }).eq('rep_asin', asin)
    enriched++
  }

  return NextResponse.json({ ok: true, enriched, distinctDue: asins.length, tokensLeft })
}
