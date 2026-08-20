// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/browse — the fast, sortable "Browse all" view of the shared
// Creator Connections catalog (cc_campaign_catalog, migration 161).
//
// Unlike /catalog-search (which gates by MVP's proprietary rules and hands a
// shortlist to SCOUT to live-verify), this is a plain, instant browse of every
// still-running campaign — the CreatorKit-style table: rate · budget left ·
// slots claimed · days left — with the user's own sort/filter, sub-second, no
// Amazon traffic and no per-user cost (one shared cache read).
//
// Product-signal columns (recent sales, rating, video count) are NOT here yet —
// those arrive in a follow-up once the catalog's ASINs are Keepa-enriched; this
// route only serves the campaign-economics the catalog already holds.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { type Tier } from '@/lib/tier'
import { ccAccessOk } from '@/lib/cc-access'
import { toUserMessage } from '@/lib/friendly-error'
import { CC_SMART_RULES, hitsAvoidList } from '@/lib/cc-smart-rules'

export const dynamic = 'force-dynamic'

type SortKey = 'commission' | 'endingSoon' | 'mostRunway' | 'slots' | 'budget' | 'recentSales' | 'rating'
const PAGE_SIZE = 40

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // CC is NOT a paid-tier feature — it's access-gated by proof you actually
    // have Creator Connections (the cc_verified_at gate below). Read `tier` ALONE
    // (it always exists) only to exempt admin from the verification gate.
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (tierRow?.tier as Tier) ?? 'trial'

    // Confidentiality gate: the shared Creator Connections catalog is Amazon
    // reference data for INVITED creators only. Browse stays locked until SCOUT
    // has confirmed the user's own CC grid renders for them (cc_verified_at,
    // stamped by a live grid scan). Smart Scan is self-gating, so it needs none.
    // - Admin is the operator: exempt.
    // - If cc_verified_at doesn't exist yet (migration 199 not applied), FAIL
    //   OPEN (allow browse) rather than locking everyone out of a stamp they
    //   can't write — the gate simply activates once the column lands.
    if (!(await ccAccessOk(supabase, user.id, tier))) {
      return NextResponse.json({ needsCcVerify: true, error: 'Verify your Creator Connections access to browse the campaign catalog.' }, { status: 403 })
    }

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
    const minCommission = numParam(url, 'minCommission') ?? 0
    const minDaysLeft = Math.max(0, numParam(url, 'minDaysLeft') ?? 0)
    const openSlotsOnly = url.searchParams.get('openSlots') === '1'
    const minRating = numParam(url, 'minRating')
    const minRecentSales = intParam(url, 'minRecentSales')
    // Carousel-video saturation band: 'none' = 0 videos (untapped), '1-6' = 1 to
    // 6, '6+' = more than 6 (crowded). Empty = no filter. Fewer videos = less
    // competition to stand out.
    const videoBand = url.searchParams.get('videos') || ''
    const sort = (url.searchParams.get('sort') || 'commission') as SortKey
    const page = Math.max(0, intParam(url, 'page') ?? 0)
    // MVP picks: layer MVP's Focus rulebook (commission / runway / price / demand
    // / rating floors + carousel required) on top of the user's filters. It reads
    // the already-enriched catalog columns, so it costs NOTHING extra (unlike the
    // Amazon-side MVP picks, which hydrates cards). Needs the signal columns.
    const mvpPicks = url.searchParams.get('mvpPicks') === '1'

    // "Still running" is the baseline; minDaysLeft raises the runway floor.
    const runwayCutoff = new Date(Date.now() + minDaysLeft * 86_400_000).toISOString().slice(0, 10)
    // MVP picks' own runway floor (stricter of the two applies).
    const mvpRunwayCutoff = new Date(Date.now() + CC_SMART_RULES.minDaysLeft * 86_400_000).toISOString().slice(0, 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const BASE_COLS = 'campaign_id, campaign_name, brand_name, asins, commission_pct, starts_at, ends_at, budget, budget_remaining, available_slot, total_slot'
    // NOTE: sales_rank_avg90 (migration 264) is deliberately NOT in this list.
    // The whole signal SELECT fails as a unit if any column is missing, so
    // coupling it to the newest migration would silently drop ALL card signals
    // (rank/rating/sales) on a DB that has 263 but not 264. avg90 is a
    // nice-to-have (rank-trend line) — not worth risking the rest of the page.
    const SIGNAL_COLS = 'image_url, price_now_cents, price_was_cents, discount_pct, rating, review_count, monthly_sold, video_count, category, parent_asin, sales_rank, sales_rank_category, listed_since'
    const SIGNAL_SORTS = new Set<SortKey>(['recentSales', 'rating'])

    // `signals` on ⇒ select/filter/sort the enriched product columns (migration
    // 197). Falls back to base-only if those columns don't exist yet, so a deploy
    // that lands before the migration never breaks the live Browse view.
    // `keyword`: 'fts' = indexed search_vec, 'ilike' = pre-162 fallback, 'none'.
    const build = (signals: boolean, keyword: 'fts' | 'ilike' | 'none') => {
      let query = sb.from('cc_campaign_catalog')
        .select(signals ? `${BASE_COLS}, ${SIGNAL_COLS}` : BASE_COLS)
        .gte('ends_at', runwayCutoff)
      if (minCommission > 0) query = query.gte('commission_pct', minCommission)
      if (openSlotsOnly) query = query.gt('available_slot', 0)
      if (signals) {
        // Product-signal filters are STRICT: a filter must mean what it says.
        // "500+ sold/mo" only matches rows we KNOW sold 500+ — a product with no
        // sales history does NOT pass. Same for rating and carousel-video count.
        // Unenriched rows (null signal) are excluded from a signal-filtered view;
        // they reappear the moment enrichment fills their data.
        if (minRating != null) query = query.gte('rating', minRating)
        if (minRecentSales != null) query = query.gte('monthly_sold', minRecentSales)
        // MVP picks overrides the video-band filter (it requires a carousel).
        if (!mvpPicks && videoBand === 'none') query = query.eq('video_count', 0)
        else if (!mvpPicks && videoBand === '1-6') query = query.gte('video_count', 1).lte('video_count', 6)
        else if (!mvpPicks && videoBand === '6+') query = query.gt('video_count', 6)
      }
      // MVP Focus rulebook — the stricter of user filter vs MVP floor wins because
      // both constraints apply. Requires the signal columns (price/rating/sales/
      // video), so mvpPicks always runs the `signals` path.
      if (mvpPicks && signals) {
        query = query
          .gte('commission_pct', CC_SMART_RULES.minCommissionPct)
          .gte('ends_at', mvpRunwayCutoff)
          .gte('rating', CC_SMART_RULES.minRating)
          .gte('monthly_sold', CC_SMART_RULES.minMonthlySales)
          .gte('price_now_cents', CC_SMART_RULES.minPrice * 100)
          .lte('price_now_cents', CC_SMART_RULES.maxPrice * 100)
          .gt('video_count', 0)
      }
      if (keyword === 'fts') query = query.textSearch('search_vec', q, { type: 'websearch' })
      else if (keyword === 'ilike') query = query.ilike('campaign_name', `%${q}%`)
      const effSort: SortKey = (!signals && SIGNAL_SORTS.has(sort)) ? 'commission' : sort
      return applySort(query, effSort)
    }

    const lo = page * PAGE_SIZE, hi = lo + PAGE_SIZE - 1
    let data, error
    if (mvpPicks) {
      // MVP picks NEEDS the signal columns to gate on price/rating/sales/video,
      // so it never falls back to the base-only path (which would silently return
      // non-vetted campaigns). Only the keyword transport degrades (fts → ilike).
      ;({ data, error } = await build(true, q ? 'fts' : 'none').range(lo, hi))
      if (error && q) { ({ data, error } = await build(true, 'ilike').range(lo, hi)) }
    } else {
      ;({ data, error } = await build(true, q ? 'fts' : 'none').range(lo, hi))
      // Signal path failed for ANY reason (columns absent pre-197, an .or() hiccup,
      // etc.) → retry base-only. Broad on purpose: a signal-query error must never
      // 500 the whole Browse and wipe the results — it just drops the enriched
      // filters and returns the campaign economics.
      if (error) {
        ;({ data, error } = await build(false, q ? 'fts' : 'none').range(lo, hi))
      }
      // search_vec absent (migration 162) or another keyword hiccup → ILIKE, base-safe.
      if (error && q) {
        ;({ data, error } = await build(false, 'ilike').range(lo, hi))
      }
    }
    if (error) {
      console.error('[campaigns/browse]', error.message)
      return NextResponse.json({ error: toUserMessage(error, 'Could not load campaigns just now. Please try again in a moment.') }, { status: 500 })
    }

    type Row = {
      campaign_id: string; campaign_name: string; brand_name: string | null
      asins: string[]; commission_pct: number; starts_at: string | null; ends_at: string
      budget: number | null; budget_remaining: number | null
      available_slot: number | null; total_slot: number | null
    }
    // Many CC campaigns arrive with an EMPTY asins[] — the ASIN lives only in
    // the campaign name (e.g. "B0FHK9DYTC 6L Cool Mist Humidifier 10%"). Browse
    // used to drop those (it needs an ASIN for the card), which is why a keyword
    // with thousands of catalog matches showed only the handful that happened to
    // carry a populated asins column. Recover the ASIN from the name so they all
    // show (and can be enriched on demand / linked / bought).
    let rows = ((data ?? []) as Row[]).filter(r => pickAsin(r) != null)
    // MVP picks also drops the "never" categories (supplements / food / pharmacy
    // / clothing) — the one gate that isn't a clean numeric column. Best-effort on
    // the page; pagination is unaffected (hasMore still reflects the DB window).
    if (mvpPicks) {
      rows = rows.filter(r => !hitsAvoidList({ campaignName: r.campaign_name, brand: r.brand_name, crumbs: null }, CC_SMART_RULES))
    }
    const campaigns = rows.map(toClient)
    return NextResponse.json({ ok: true, page, campaigns, hasMore: (data ?? []).length === PAGE_SIZE })
  } catch (err) {
    console.error('[campaigns/browse]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not load campaigns just now. Please try again in a moment.') }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: SortKey) {
  switch (sort) {
    case 'endingSoon':  return query.order('ends_at', { ascending: true }).order('campaign_id', { ascending: true })
    case 'mostRunway':  return query.order('ends_at', { ascending: false }).order('campaign_id', { ascending: true })
    case 'slots':       return query.order('available_slot', { ascending: false, nullsFirst: false }).order('campaign_id', { ascending: true })
    case 'budget':      return query.order('budget_remaining', { ascending: false, nullsFirst: false }).order('campaign_id', { ascending: true })
    case 'recentSales': return query.order('monthly_sold', { ascending: false, nullsFirst: false }).order('commission_pct', { ascending: false })
    case 'rating':      return query.order('rating', { ascending: false, nullsFirst: false }).order('review_count', { ascending: false, nullsFirst: false })
    case 'commission':
    default:            return query.order('commission_pct', { ascending: false }).order('ends_at', { ascending: true }).order('campaign_id', { ascending: true })
  }
}

// Amazon ASINs are 10 alphanumerics; CC products are effectively all B0-prefixed.
// CC campaign names very often embed the ASIN when the asins column is empty.
const ASIN_IN_NAME = /\bB0[A-Z0-9]{8}\b/i
function extractAsinFromName(name: string | null | undefined): string | null {
  if (!name) return null
  const m = name.match(ASIN_IN_NAME)
  return m ? m[0].toUpperCase() : null
}
// The campaign's representative ASIN: the stored asins[0], else recovered from
// the campaign name.
function pickAsin(r: { asins?: string[] | null; campaign_name?: string | null }): string | null {
  const first = Array.isArray(r.asins) && r.asins[0] ? String(r.asins[0]).toUpperCase() : null
  return first || extractAsinFromName(r.campaign_name)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClient(r: any) {
  let daysLeft: number | null = null
  try { daysLeft = Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - Date.now()) / 86_400_000)) } catch { /* keep null */ }
  const total = typeof r.total_slot === 'number' ? r.total_slot : null
  const open = typeof r.available_slot === 'number' ? r.available_slot : null
  const claimed = total != null && open != null ? Math.max(0, total - open) : null
  const budget = typeof r.budget === 'number' ? r.budget : null
  const budgetRemaining = typeof r.budget_remaining === 'number' ? r.budget_remaining : null
  const budgetPct = budget != null && budget > 0 && budgetRemaining != null
    ? Math.max(0, Math.min(100, Math.round((budgetRemaining / budget) * 100))) : null
  return {
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    brand: r.brand_name,
    asin: pickAsin(r) as string,
    asinCount: (Array.isArray(r.asins) && r.asins.length) ? r.asins.length : 1,
    commissionPct: Number(r.commission_pct),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    daysLeft,
    slotsOpen: open,
    totalSlot: total,
    slotsClaimed: claimed,
    budget,
    budgetRemaining,
    budgetPct,
    // Product signals (null until the enrichment cron has reached this product).
    imageUrl: r.image_url ?? null,
    priceNow: r.price_now_cents != null ? Math.round(r.price_now_cents) / 100 : null,
    priceWas: r.price_was_cents != null ? Math.round(r.price_was_cents) / 100 : null,
    discountPct: r.discount_pct ?? null,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewCount: r.review_count ?? null,
    monthlySold: r.monthly_sold ?? null,
    videoCount: r.video_count ?? null,
    hasVideo: typeof r.video_count === 'number' && r.video_count > 0,
    // Extra Keepa signals (parity with Oink).
    category: r.category ?? null,
    parentAsin: r.parent_asin ?? null,
    salesRank: r.sales_rank ?? null,
    salesRankAvg90: r.sales_rank_avg90 ?? null,
    salesRankCategory: r.sales_rank_category ?? null,
    listedSince: r.listed_since ?? null,
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
