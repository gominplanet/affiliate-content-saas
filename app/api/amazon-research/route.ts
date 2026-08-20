// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-research — filterable browse of the WHOLE Amazon catalogue.
//
// This is the "Amazon Product Research" side of the finder: NOT deals, NOT
// Creator Connections campaigns — just the regular Amazon catalogue, searchable
// by MVP filters (keyword, price, rating, reviews, best-sellers, category).
//
// Engine: Keepa Product Finder (/query) returns matching ASINs by attribute;
// the Amazon Creators API then hydrates image / title / price for the page of
// ASINs shown. Each product link carries the CREATOR'S OWN Associates tag (from
// integrations.amazon_associates_tag) so clicks earn on their account — falling
// back to the operator tag only when the creator hasn't set one.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { type Tier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'
import { keepaProductFinder, fetchKeepaProductCard, fetchKeepaTokenStatus, keepaConfigured, type KeepaFinderFilters } from '@/services/keepa'
import { getItemsByAsin, creatorsApiConfigured } from '@/services/amazon-creators'
import { recordUsage } from '@/lib/ai-usage'
import { ONSITE_RULES } from '@/lib/cc-smart-rules'
import { normalizeTier } from '@/lib/tier'

// MVP picks: how many finder hits to deep-verify per page against MVP's onsite
// buy-to-review rules (carousel + real demand). Each ≈ 2 Keepa tokens, so it's
// bounded and paid-only.
const MVP_PICKS_VERIFY_CAP = 15

// Live-enrich the TOP N results of every search (paid tiers) with a cached
// Keepa product call (~1 token each, no offers). The finder only returns ASINs,
// and cache-only enrichment leaves fresh searches (products we've never seen)
// bare — so the first cards a creator actually looks at now carry full signals
// (price, rating, sales, rank, trend, age, video). The rest stay light and use
// the on-demand "Data" button. Trial stays cache-only (already daily-capped).
const LIVE_ENRICH_CAP = 12
// Only live-enrich when the shared Keepa pool has at least this much headroom
// beyond the enrichment cost, so enrichment never tips the key toward the 429/
// negative-balance state that makes searches return nothing.
const LIVE_ENRICH_MIN_TOKENS = 150

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Free/trial users get this many Amazon Product Research searches per day (each
// ≈ 10 Keepa tokens). Insurance against a scraper draining the shared token
// pool; paid tiers are uncapped. Bump freely — it's a single number.
const FREE_SEARCHES_PER_DAY = 50

// Keepa rootCategory ids (= Amazon US browse nodes). VERIFIED — kept in sync
// with Deal Radar's swept nodes (app/api/cron/refresh-deal-radar). id 0 = all.
const CATEGORIES: Array<{ id: number; label: string }> = [
  { id: 0, label: 'All categories' },
  { id: 172282, label: 'Electronics' },
  { id: 1055398, label: 'Home & Kitchen' },
  { id: 3375251, label: 'Sports & Outdoors' },
  { id: 3760901, label: 'Health & Household' },
  { id: 3760911, label: 'Beauty & Personal Care' },
  { id: 228013, label: 'Tools & Home Improvement' },
  { id: 165793011, label: 'Toys & Games' },
  { id: 2619533011, label: 'Pet Supplies' },
  { id: 1064954, label: 'Office Products' },
  { id: 15684181, label: 'Automotive' },
  { id: 165796011, label: 'Baby' },
  { id: 7141123011, label: 'Clothing, Shoes & Jewelry' },
  { id: 541966, label: 'Computers' },
  { id: 2335752011, label: 'Cell Phones & Accessories' },
  { id: 16310101, label: 'Grocery & Gourmet Food' },
  { id: 11091801, label: 'Musical Instruments' },
  { id: 2972638011, label: 'Patio, Lawn & Garden' },
  { id: 468642, label: 'Video Games' },
  { id: 2619525011, label: 'Appliances' },
  { id: 2617941011, label: 'Arts, Crafts & Sewing' },
  { id: 16310161, label: 'Industrial & Scientific' },
  { id: 9479199011, label: 'Luggage & Travel Gear' },
  { id: 283155, label: 'Books' },
  { id: 2625373011, label: 'Movies & TV' },
  { id: 3367581, label: 'Jewelry' },
  { id: 6358539011, label: 'Watches' },
]
const VALID_CATEGORY = new Set(CATEGORIES.map(c => c.id))

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Amazon Product Research SEARCH is free for every signed-in tier — it's the
    // read-only conversion magnet (like Deal Radar browse). Acting on a result
    // (Save / Write review / Deep-dive) still requires a paid plan, enforced on
    // those routes. Free/trial gets a daily search cap so a scraper can't drain
    // the shared Keepa token pool (each search ≈ 10 tokens).
    const { data: intRow } = await supabase
      .from('integrations').select('tier, amazon_associates_tag').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    const isAdmin = tier === 'admin'
    if (tier === 'trial') {
      const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
      const { count } = await supabase
        .from('ai_usage').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('feature', 'amazon_research')
        .gte('created_at', startOfDay.toISOString())
      if ((count ?? 0) >= FREE_SEARCHES_PER_DAY) {
        return NextResponse.json({
          error: `You've used all ${FREE_SEARCHES_PER_DAY} free Amazon searches for today. Upgrade for unlimited research, or come back tomorrow.`,
          limitReached: true, currentTier: tier,
        }, { status: 429 })
      }
    }

    if (!keepaConfigured()) {
      return NextResponse.json({ error: 'Amazon Product Research is warming up. Please try again shortly.' }, { status: 503 })
    }

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
    // MVP picks: apply MVP's onsite buy-to-review rulebook (price/rating/review
    // floors in the finder, then verify an open video carousel + real monthly
    // demand per product). Costs extra Keepa tokens, so it's paid-only.
    const mvpPicks = url.searchParams.get('mvpPicks') === '1'
    if (mvpPicks && normalizeTier(tier) === 'trial') {
      return NextResponse.json({
        error: 'MVP picks (carousel-verified, buy-to-review vetted) is a paid feature. Upgrade to unlock it — plain research stays free.',
        upgradeRequired: true, currentTier: tier,
      }, { status: 403 })
    }
    let minPrice = numParam(url, 'minPrice')        // dollars
    const maxPrice = numParam(url, 'maxPrice')      // dollars
    let minRating = numParam(url, 'minRating')      // 0–5
    let minReviews = intParam(url, 'minReviews')
    // MVP picks raises the finder floors to the onsite rulebook (never lowers a
    // stricter value the user already set).
    if (mvpPicks) {
      minPrice = Math.max(minPrice ?? 0, ONSITE_RULES.minPrice)
      minRating = Math.max(minRating ?? 0, ONSITE_RULES.minRating)
      minReviews = Math.max(minReviews ?? 0, ONSITE_RULES.minReviews)
    }
    const maxSalesRank = intParam(url, 'maxSalesRank')
    const catParam = intParam(url, 'category')
    const rootCategory = catParam != null && VALID_CATEGORY.has(catParam) && catParam > 0 ? catParam : undefined
    const sort = normalizeSort(url.searchParams.get('sort'))
    const page = Math.max(0, intParam(url, 'page') ?? 0)
    // Keepa Product Finder's minimum perPage is 50 — smaller is rejected.
    const PER_PAGE = 50

    // Require at least one real filter so we never fire a wide-open scan that
    // burns Keepa tokens on a random slice of 240M products.
    const hasFilter = !!q || minPrice != null || maxPrice != null || minRating != null
      || minReviews != null || maxSalesRank != null || rootCategory != null
    if (!hasFilter) {
      return NextResponse.json({ ok: true, page, products: [], hasMore: false, needsFilter: true })
    }

    const filters: KeepaFinderFilters = {
      title: q || undefined,
      priceRangeCents: (minPrice != null || maxPrice != null)
        ? [minPrice != null ? Math.round(minPrice * 100) : null, maxPrice != null ? Math.round(maxPrice * 100) : null]
        : undefined,
      minRating: minRating ?? undefined,
      minReviews: minReviews ?? undefined,
      maxSalesRank: maxSalesRank ?? undefined,
      rootCategory,
      sort,
      page,
      perPage: PER_PAGE,
    }

    const found = await keepaProductFinder(filters)
    // Count this search against the free daily cap (a Keepa token was spent the
    // moment the query fired, results or not). Trial only; paid is uncapped.
    if (tier === 'trial') recordUsage({ userId: user.id, tier, feature: 'amazon_research', model: 'keepa-finder' })
    // Safe, numbers-only diagnostic (never raw provider text) — shown to admins
    // in the empty state so a "no results" is explainable (bad status / no tokens
    // / genuinely zero matches) instead of a silent dead end.
    const debug = isAdmin
      ? { status: found.status, tokensLeft: found.tokensLeft, totalResults: found.totalResults, matched: found.asins.length, error: found.error }
      : undefined
    if (!found.asins.length) {
      return NextResponse.json({ ok: true, page, products: [], hasMore: false, debug })
    }

    // Hydrate image / title / price for this page of ASINs via the Creators API
    // (best-effort — if it isn't configured or rate-limits, we still return the
    // ASINs with tagged links, just without images).
    const tag = ((intRow?.amazon_associates_tag as string | null) || '').trim() || null

    // ── MVP picks: verify the onsite buy-to-review rules per product ──────────
    // The finder already floored price/rating/reviews; here we deep-check each
    // candidate for an OPEN VIDEO CAROUSEL (the traffic mechanism) and real
    // MONTHLY DEMAND — the two signals the finder can't filter on. Bounded +
    // paid-only (each card ≈ 2 Keepa tokens).
    if (mvpPicks) {
      const slice = found.asins.slice(0, MVP_PICKS_VERIFY_CAP)
      const verified = await Promise.all(slice.map(async asin => ({ asin, card: await fetchKeepaProductCard(asin) })))
      recordUsage({ userId: user.id, tier, feature: 'amazon_research_mvp', model: 'keepa-card' })
      const passing = verified.filter(({ card }) =>
        (card.videoCount ?? 0) > 0
        && (card.monthlySold ?? 0) >= ONSITE_RULES.minMonthlySales
        && (card.priceNowCents ?? 0) >= ONSITE_RULES.minPrice * 100,
      )
      const info = creatorsApiConfigured() ? await getItemsByAsin(passing.map(p => p.asin)) : new Map()
      const mvpProducts = passing.map(({ asin, card }) => ({
        asin,
        title: info.get(asin)?.title ?? null,
        imageUrl: info.get(asin)?.imageUrl ?? null,
        priceNow: card.priceNowCents != null ? Math.round(card.priceNowCents) / 100 : null,
        productUrl: taggedLink(asin, tag),
        mvpApproved: true,
        monthlySold: card.monthlySold ?? null,
        rating: card.rating ?? null,
        reviewCount: card.reviewCount ?? null,
        videoCount: card.videoCount ?? 0,
      }))
      return NextResponse.json({
        ok: true, page, products: mvpProducts,
        hasMore: found.asins.length === PER_PAGE, hasOwnTag: !!tag,
        mvpPicks: true, scanned: slice.length,
      })
    }

    const cards = creatorsApiConfigured() ? await getItemsByAsin(found.asins) : new Map()

    // FREE signal enrichment: rating / reviews / monthly-sold aren't returned by
    // the finder or the Creators API (and per-product Keepa calls are the paid
    // MVP-picks path). But we OFTEN already hold these for an ASIN in our own
    // caches — the storefront product cards and the shared Deal Radar cache. Pull
    // from those at zero Keepa cost so plain result cards show signals wherever we
    // have them; ASINs we've never seen just stay title/image/price.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    interface Sig { rating: number | null; reviewCount: number | null; monthlySold: number | null; category: string | null; parentAsin: string | null; salesRank: number | null; salesRankAvg90: number | null; salesRankCategory: string | null; listedSince: string | null }
    const sig = new Map<string, Sig>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toSig = (r: any): Sig => ({
      rating: r.rating ?? null, reviewCount: r.review_count ?? null, monthlySold: r.monthly_sold ?? null,
      category: r.category ?? null, parentAsin: r.parent_asin ?? null,
      // Only trust the numeric rank when the named category came with it (the
      // deal cache seeds sales_rank with a category ref id until enrichment).
      salesRank: r.sales_rank_category && r.sales_rank != null ? r.sales_rank : null,
      salesRankAvg90: null, // filled by the separate avg90 pass below
      salesRankCategory: r.sales_rank_category ?? null, listedSince: r.listed_since ?? null,
    })
    try {
      const COLS = 'asin,rating,review_count,monthly_sold,category,parent_asin,sales_rank,sales_rank_category,listed_since'
      const [{ data: sc }, { data: dr }] = await Promise.all([
        sb.from('storefront_product_cards').select(COLS).in('asin', found.asins),
        sb.from('deal_radar_cache').select(COLS).in('asin', found.asins),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (dr ?? []) as any[]) sig.set(r.asin, toSig(r))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (sc ?? []) as any[]) sig.set(r.asin, toSig(r)) // prefer our fresher storefront card
    } catch { /* enrichment is best-effort */ }
    // 90-day average rank (migration 264) — fetched separately so its column
    // being absent can't blank the 263 signals fetched above. Only patches rows
    // that already have a real named rank, so avg90 is only shown with a rank.
    try {
      const A90 = 'asin,sales_rank_avg90'
      const [{ data: sca }, { data: dra }] = await Promise.all([
        sb.from('storefront_product_cards').select(A90).in('asin', found.asins),
        sb.from('deal_radar_cache').select(A90).in('asin', found.asins),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch = (rows: any[]) => { for (const r of rows) { const s = sig.get(r.asin); if (s && s.salesRank != null && r.sales_rank_avg90 != null) s.salesRankAvg90 = r.sales_rank_avg90 } }
      patch((dra ?? []) as any[]); patch((sca ?? []) as any[])
    } catch { /* avg90 column not applied yet — omit it */ }

    // Live-enrich the top N (paid tiers) so the most-looked-at cards are full
    // even for never-cached products. Cached Keepa reads, bounded to LIVE_ENRICH_CAP.
    //
    // TOKEN GUARD: the shared operator key feeds Deal Radar + CC enrichment +
    // this finder too, and it can run dry (a 429 with a negative balance is what
    // makes a search return nothing). So we only spend the ~12 enrichment tokens
    // when the pool has real headroom — the token-status read is FREE (doesn't
    // consume tokens). Low/unknown balance → skip enrichment, fall back to
    // cache-only signals. Enrichment must never be the thing that drains search.
    const live = new Map<string, Awaited<ReturnType<typeof fetchKeepaProductCard>>>()
    if (tier !== 'trial' && found.asins.length) {
      const { tokensLeft } = await fetchKeepaTokenStatus()
      if (tokensLeft != null && tokensLeft > LIVE_ENRICH_MIN_TOKENS) {
        const slice = found.asins.slice(0, LIVE_ENRICH_CAP)
        const enriched = await Promise.all(slice.map(async asin => ({ asin, card: await fetchKeepaProductCard(asin) })))
        for (const { asin, card } of enriched) live.set(asin, card)
        recordUsage({ userId: user.id, tier, feature: 'amazon_research_enrich', model: 'keepa-card' })
      }
    }

    const products = found.asins.map(asin => {
      const card = cards.get(asin)
      const s = sig.get(asin)
      const lc = live.get(asin)
      return {
        asin,
        title: card?.title ?? null,
        imageUrl: card?.imageUrl ?? lc?.imageUrl ?? null,
        // Creators-API price first (the tagged storefront price), then the live
        // Keepa buy-box price for products the Creators API didn't return.
        priceNow: card?.priceCents != null ? Math.round(card.priceCents) / 100
          : lc?.priceNowCents != null ? Math.round(lc.priceNowCents) / 100 : null,
        priceWas: lc?.priceWasCents != null ? Math.round(lc.priceWasCents) / 100 : null,
        discountPct: lc?.discountPct ?? null,
        productUrl: taggedLink(asin, tag),
        rating: lc?.rating ?? s?.rating ?? null,
        reviewCount: lc?.reviewCount ?? s?.reviewCount ?? null,
        monthlySold: lc?.monthlySold ?? s?.monthlySold ?? null,
        videoCount: lc?.videoCount ?? undefined,
        category: lc?.category ?? s?.category ?? null,
        parentAsin: lc?.parentAsin ?? s?.parentAsin ?? null,
        salesRank: lc?.salesRank ?? s?.salesRank ?? null,
        salesRankAvg90: lc?.salesRankAvg90 ?? s?.salesRankAvg90 ?? null,
        salesRankCategory: lc?.salesRankCategory ?? s?.salesRankCategory ?? null,
        listedSince: lc?.listedSince ?? s?.listedSince ?? null,
      }
    })

    return NextResponse.json({
      ok: true,
      page,
      products,
      hasMore: found.asins.length === PER_PAGE,
      hasOwnTag: !!tag,
    })
  } catch (err) {
    console.error('[amazon-research]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not search Amazon just now. Please try again in a moment.') }, { status: 500 })
  }
}

/** A /dp/ASIN link carrying the creator's own Associates tag (operator tag as a
 *  fallback so links always attribute somewhere). */
function taggedLink(asin: string, ownTag: string | null): string {
  const tag = ownTag || (process.env.AMAZON_PARTNER_TAG || '').trim()
  const base = `https://www.amazon.com/dp/${asin}`
  return tag ? `${base}?tag=${encodeURIComponent(tag)}` : base
}

function normalizeSort(v: string | null): KeepaFinderFilters['sort'] {
  switch (v) {
    case 'reviews': return 'reviews'
    case 'rating': return 'rating'
    case 'priceLow': return 'priceLow'
    case 'priceHigh': return 'priceHigh'
    case 'salesRank':
    default: return 'salesRank'
  }
}

function intParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null
}
function numParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key); if (v == null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
