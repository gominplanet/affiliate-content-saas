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
import { fetchKeepaDeals, keepaConfigured, type KeepaDeal } from '@/services/keepa'

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

  // 2. Precompute the Amazon Creator Connections match (shared catalog). Best
  //    still-running, in-budget, slots-available campaign per ASIN. Best-effort:
  //    any failure just leaves campaign fields null.
  const ccByAsin = await matchCreatorConnections(admin, deals.map((d) => d.asin))

  // 3. Upsert. first_seen_at intentionally omitted so it survives (it defaults
  //    on insert, and upsert only writes the columns we pass).
  const nowIso = new Date().toISOString()
  const rows = deals.map((d) => {
    const cc = ccByAsin.get(d.asin)
    return {
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
      campaign_id: cc?.campaignId ?? null,
      campaign_commission_pct: cc?.commissionPct ?? null,
      campaign_brand: cc?.brand ?? null,
      campaign_details_url: cc?.detailsUrl ?? null,
      refreshed_at: nowIso,
    }
  })

  let upserted = 0
  // Chunk the upsert so a huge sweep can't exceed statement limits.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('deal_radar_cache').upsert(chunk, { onConflict: 'asin' })
    if (!error) upserted += chunk.length
  }

  // 4. Purge deals that fell out of the feed (not re-seen in STALE_HOURS).
  const staleBefore = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('deal_radar_cache').delete().lt('refreshed_at', staleBefore)

  return NextResponse.json({
    ok: true,
    fetched: deals.length,
    upserted,
    withCampaign: [...ccByAsin.keys()].length,
    stoppedForTokens,
    tokensLeft: lastTokensLeft,
  })
}

interface CcMatch { campaignId: string; commissionPct: number; brand: string | null; detailsUrl: string | null }

/**
 * For a batch of ASINs, find the best active Creator Connections campaign each
 * one belongs to, from the shared cc_campaign_catalog (GIN index on `asins`).
 * "Active" = not ended, budget left, slots left. Returns a map asin → best.
 * Best-effort: returns an empty map on any error (catalog absent, etc.).
 */
async function matchCreatorConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  asins: string[],
): Promise<Map<string, CcMatch>> {
  const out = new Map<string, CcMatch>()
  if (!asins.length) return out
  const today = new Date().toISOString().slice(0, 10)
  const wanted = new Set(asins)
  try {
    // Pull catalog rows whose asins overlap the batch. Query in chunks so the
    // overlap array stays a reasonable size.
    for (let i = 0; i < asins.length; i += 100) {
      const chunk = asins.slice(i, i + 100)
      const { data } = await admin
        .from('cc_campaign_catalog')
        .select('campaign_id,brand_name,asins,commission_pct,ends_at,budget_remaining,available_slot')
        .overlaps('asins', chunk)
        .gte('ends_at', today)
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const commissionPct = Number(row.commission_pct)
        if (!Number.isFinite(commissionPct) || commissionPct <= 0) continue
        // Skip exhausted campaigns (null = unknown/unlimited → allowed).
        const budget = row.budget_remaining
        if (budget != null && Number(budget) <= 0) continue
        const slot = row.available_slot
        if (slot != null && Number(slot) <= 0) continue
        const campaignId = String(row.campaign_id || '')
        const brand = typeof row.brand_name === 'string' ? row.brand_name : null
        const detailsUrl = campaignId ? `https://affiliate-program.amazon.com/creatorconnections/campaign/${campaignId}` : null
        const rowAsins = Array.isArray(row.asins) ? (row.asins as string[]) : []
        for (const a of rowAsins) {
          const asin = String(a || '').toUpperCase()
          if (!wanted.has(asin)) continue
          const prev = out.get(asin)
          if (!prev || commissionPct > prev.commissionPct) {
            out.set(asin, { campaignId, commissionPct, brand, detailsUrl })
          }
        }
      }
    }
  } catch { /* catalog missing / query error — no campaign data this run */ }
  return out
}
