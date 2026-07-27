/**
 * GET /api/cron/refresh-deal-radar
 *
 * Amazon Deal Radar's central refresh. Once every few hours (vercel.json) this
 * pulls Keepa's live deals for a curated set of affiliate-niche categories into
 * the shared deal_radar_cache, and PRECOMPUTES the Amazon Creator Connections
 * match onto each row (from cc_campaign_catalog) so the "double-win" ticker is a
 * single indexed read for every user.
 *
 * SHARED, not per-user: one operator Keepa key feeds a cache the whole community
 * reads. Cost = categories × cadence, independent of user count.
 *
 * Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Fully env-gated: with KEEPA_API_KEY unset this returns {skipped} and touches
 * nothing, so it's safe to ship before the key exists.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaDeals, fetchKeepaProductStats, keepaConfigured, type KeepaDeal } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Keepa category ids (= Amazon US browse nodes) to sweep — the niches affiliate
 * creators actually work. Override with DEAL_RADAR_CATEGORIES (comma-separated)
 * without a deploy. ~18 nodes at one page each keeps token spend modest.
 */
const DEFAULT_CATEGORIES = [
  172282,      // Electronics
  1055398,     // Home & Kitchen
  3375251,     // Sports & Outdoors
  3760901,     // Health & Household
  3760911,     // Beauty & Personal Care
  228013,      // Tools & Home Improvement
  165793011,   // Toys & Games
  2619533011,  // Pet Supplies
  1064954,     // Office Products
  15684181,    // Automotive
  165796011,   // Baby
  7141123011,  // Clothing, Shoes & Jewelry
  541966,      // Computers
  2335752011,  // Cell Phones & Accessories
  16310101,    // Grocery & Gourmet Food
  11091801,    // Musical Instruments
  2972638011,  // Patio, Lawn & Garden
  468642,      // Video Games
]

/** Below this many Keepa tokens we stop early and finish next run — never run
 *  the balance to zero mid-sweep. */
const MIN_TOKENS_TO_CONTINUE = 40
/** Drop cached deals we haven't re-seen in this long (fell out of the feed). */
const STALE_HOURS = 48

function categories(): number[] {
  const raw = (process.env.DEAL_RADAR_CATEGORIES || '').trim()
  if (!raw) return DEFAULT_CATEGORIES
  const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
  return ids.length ? ids : DEFAULT_CATEGORIES
}

function minDiscount(): number {
  const n = Number(process.env.DEAL_RADAR_MIN_DISCOUNT)
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 15
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'keepa_unconfigured' })
  }

  const admin = createAdminClient()
  const cats = categories()
  const minPct = minDiscount()

  // 1. Sweep each category (one page each), stopping early on low tokens. We
  //    dedupe by ASIN across categories, keeping the biggest discount.
  const byAsin = new Map<string, KeepaDeal>()
  let stoppedForTokens = false
  let lastTokensLeft: number | null = null
  for (const categoryId of cats) {
    const page = await fetchKeepaDeals({ includeCategories: [categoryId], minDiscountPct: minPct })
    for (const d of page.deals) {
      const prev = byAsin.get(d.asin)
      if (!prev || (d.discountPct ?? 0) > (prev.discountPct ?? 0)) byAsin.set(d.asin, d)
    }
    lastTokensLeft = page.tokensLeft ?? lastTokensLeft
    if (page.tokensLeft != null && page.tokensLeft < MIN_TOKENS_TO_CONTINUE) { stoppedForTokens = true; break }
  }

  const deals = [...byAsin.values()]
  if (deals.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, stoppedForTokens, tokensLeft: lastTokensLeft })
  }

  // 2. Upsert. first_seen_at intentionally omitted so it survives (it defaults
  //    on insert, and upsert only writes the columns we pass). The campaign_*
  //    columns are NOT written here — they're stamped in step 3 by a set-based
  //    match over the WHOLE cache (see match_deal_radar_campaigns), so deals that
  //    accumulated across earlier runs get matched too, not just this sweep.
  const nowIso = new Date().toISOString()
  const rows = deals.map((d) => ({
    asin: d.asin,
    title: d.title.slice(0, 500),
    brand: d.brand,
    image_url: d.imageUrl,
    category_id: d.categoryId,
    price_now_cents: d.priceNowCents,
    price_was_cents: d.priceWasCents,
    discount_pct: d.discountPct,
    rating: d.rating,
    review_count: d.reviewCount,
    sales_rank: d.salesRank,
    deal_type: d.dealType,
    lightning_ends_at: d.lightningEndsAt,
    refreshed_at: nowIso,
  }))

  let upserted = 0
  // Chunk the upsert so a huge sweep can't exceed statement limits.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('deal_radar_cache').upsert(chunk, { onConflict: 'asin' })
    if (!error) upserted += chunk.length
  }

  // 3. Precompute the Amazon Creator Connections match over the ENTIRE cache in
  //    one indexed pass (GIN `@>` join). Idempotent: stamps ASINs that now match
  //    an active, in-budget campaign; clears ones that no longer do. Best-effort.
  let campaignMatched: number | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: m } = await (admin as any).rpc('match_deal_radar_campaigns')
    campaignMatched = typeof m === 'number' ? m : null
  } catch { /* catalog absent / rpc missing — leave campaign fields as-is */ }

  // 4. Verify a paced batch against price history (the "real deal?" layer).
  //    Keepa's 20-tokens/min rate is the limiter, so we cap the batch and stop
  //    on low tokens / near the time budget; coverage grows across runs. Does
  //    NOT touch the campaign_* columns (Creator Connections match from step 2).
  const verified = await enrichPriceHistory(admin, lastTokensLeft)

  // 5. Purge deals that fell out of the feed (not re-seen in STALE_HOURS).
  const staleBefore = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('deal_radar_cache').delete().lt('refreshed_at', staleBefore)

  return NextResponse.json({
    ok: true,
    fetched: deals.length,
    upserted,
    campaignMatched,
    verified,
    stoppedForTokens,
    tokensLeft: lastTokensLeft,
  })
}

/** Max deals to price-verify per run (env-tunable). Kept modest so one run
 *  stays within the token rate + function timeout; the rest catch up next run. */
const ENRICH_MAX = Math.max(0, Number(process.env.DEAL_RADAR_ENRICH_MAX) || 120)
/** Re-verify a deal's price history at most this often. */
const VERIFY_TTL_HOURS = 24

/**
 * Enrich the biggest-discount, not-recently-verified deals with Keepa price
 * stats and store the verdict (quality + all-time low + "% below usual" label).
 * Best-effort + paced: bounded by ENRICH_MAX, the token balance, and a wall
 * deadline under maxDuration. Returns how many rows it verified.
 */
async function enrichPriceHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tokensLeft: number | null,
): Promise<number> {
  if (ENRICH_MAX === 0) return 0
  const deadline = Date.now() + 210_000 // stay well under maxDuration (300s)
  const staleBefore = new Date(Date.now() - VERIFY_TTL_HOURS * 3600_000).toISOString()
  let budget = tokensLeft // null = unknown; rely on deadline + ENRICH_MAX

  // Never verified, or verified > TTL ago. Biggest discounts first (most worth
  // a badge). PostgREST `.or` with a nested lt on the timestamp.
  const { data } = await admin
    .from('deal_radar_cache')
    .select('asin')
    .or(`price_verified_at.is.null,price_verified_at.lt.${staleBefore}`)
    .order('discount_pct', { ascending: false, nullsFirst: false })
    .limit(ENRICH_MAX)

  let done = 0
  for (const row of (data ?? []) as Array<{ asin: string }>) {
    if (Date.now() > deadline) break
    if (budget != null && budget < MIN_TOKENS_TO_CONTINUE) break
    const a = await fetchKeepaProductStats(row.asin)
    // Stamp price_verified_at even on a null assessment so we don't re-hammer a
    // product with no usable history every single run.
    await admin.from('deal_radar_cache').update({
      price_avg90_cents: a.avg90Cents,
      price_low_cents: a.allTimeLowCents,
      deal_quality: a.quality,
      lowest_label: a.label,
      monthly_sold: a.monthlySold,
      price_verified_at: new Date().toISOString(),
    }).eq('asin', row.asin)
    if (budget != null) budget -= 1 // a product-stats call is ~1 token
    done++
  }
  return done
}

