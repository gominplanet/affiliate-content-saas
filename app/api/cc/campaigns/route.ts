/**
 * GET /api/cc/campaigns — Creator Connections intelligence browser.
 *
 * Reads the shared cc_campaign_catalog (authenticated-readable) and returns live
 * campaigns enriched with the decision signals a creator actually needs:
 *   - campaign fullness (spots left of total, % filled, is-full)
 *   - estimated $/sale (commission × current price)
 *   - brand payout reliability (is the brand's budget actually being spent)
 *   - days left, demand (monthly sold), rating
 *   - an opportunity score to float the best ones up
 *
 * Read-only, open to any signed-in user. Data comes from the weekly admin CSV
 * import + Keepa enrichment; nothing new is scraped here.
 *
 * Query: page, limit (10-48), sort (score|commission|perSale|ending|demand),
 *        q (keyword), minCommission, payingOnly (1), hasSpots (1).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { brandTrust, campaignFullness, estPerSale, daysUntil, opportunityScore, type BrandAgg } from '@/lib/cc-intelligence'
import { ccAccessOk } from '@/lib/cc-access'
import { ccRequestUrl } from '@/lib/cc-urls'
import { productSignals, groupBySignals } from '@/lib/cc-dedupe'
import { type Tier } from '@/lib/tier'
import { ccAsinFromQuery, ccTsQuery } from '@/lib/cc-search-query'

export const dynamic = 'force-dynamic'

// Coarse DB window we pull before computing scores + paginating in-process.
//
// The opportunity score is computed per row AFTER the query (it needs the brand
// payout aggregate), and same-product campaigns are collapsed after that, so
// ranking cannot happen in SQL and a window is unavoidable. What was avoidable
// was reporting the window's size as the size of the catalogue: 300 rows
// deduplicated to 219, and the page said "219 live campaigns" while 893,644 were
// actually live. Raised to 1000, and the true match count is now returned
// separately so the page can stop presenting a sample as a total.
const WINDOW = 1000

interface CatalogRow {
  campaign_id: string
  campaign_name: string | null
  brand_name: string | null
  asins: string[] | null
  rep_asin: string | null
  commission_pct: number | null
  starts_at: string | null
  ends_at: string | null
  budget: number | null
  budget_remaining: number | null
  available_slot: number | null
  total_slot: number | null
  image_url: string | null
  price_now_cents: number | null
  price_was_cents: number | null
  discount_pct: number | null
  rating: number | null
  review_count: number | null
  monthly_sold: number | null
  sales_rank: number | null
  video_count: number | null
}

const COLS = 'campaign_id, campaign_name, brand_name, asins, rep_asin, commission_pct, starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, image_url, price_now_cents, price_was_cents, discount_pct, rating, review_count, monthly_sold, sales_rank, video_count'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    // CONFIDENTIALITY GATE: the shared CC catalog is shown ONLY to creators who
    // actually have Creator Connections. Proof = SCOUT confirmed their own CC
    // grid renders (integrations.cc_verified_at). An unverified user — any tier —
    // gets a verify prompt and ZERO catalog data. Never leak CC data to accounts
    // that don't have the invite.
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (!(await ccAccessOk(supabase, user.id, (intRow?.tier as Tier) ?? 'trial'))) {
      return NextResponse.json({ ok: false, needsCcVerify: true, error: 'Verify your Creator Connections access to browse campaigns.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(Number(searchParams.get('page')) || 1, 1)
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 24, 10), 48)
    const sort = (searchParams.get('sort') || 'score')
    const q = (searchParams.get('q') || '').trim()
    const minCommission = Number(searchParams.get('minCommission')) || 0
    const payingOnly = searchParams.get('payingOnly') === '1'
    const hasSpots = searchParams.get('hasSpots') === '1'
    const hideJoined = searchParams.get('hideJoined') === '1'
    const hidePosted = searchParams.get('hidePosted') === '1'
    // "Joined only" — the inverse of Hide joined: show ONLY campaigns this user
    // has accepted. Mutually exclusive with the hide filters (client enforces).
    const joinedOnly = searchParams.get('joinedOnly') === '1'
    const today = new Date().toISOString().slice(0, 10)

    // Joined-only: gather this user's accepted ASINs to POSITIVELY filter the
    // catalog down to them. Empty set → no joined campaigns (handled below).
    let joinedAsins: string[] = []
    if (joinedOnly) {
      // Read the PERSISTED, authoritative joined marker (amazon_joined_at) — set by
      // the SCOUT active-view sync and in-app accepts, reconciled to mirror Amazon.
      // This persists across reloads (no re-sync needed) and excludes the stale
      // accepted_at rows an early sync left behind.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: acc } = await (supabase as any)
        .from('campaigns')
        .select('asin,amazon_joined_at')
        .eq('user_id', user.id)
        .not('amazon_joined_at', 'is', null)
        .limit(4000)
      const s = new Set<string>()
      for (const r of acc ?? []) {
        const a = String(r?.asin || '').toUpperCase()
        if (/^[A-Z0-9]{10}$/.test(a)) s.add(a)
      }
      joinedAsins = [...s].slice(0, 2000)
    }

    // "Hide joined / Hide posted" — exclude this user's already-acted ASINs from
    // the query itself, so the coarse window fills with FRESH campaigns (a real
    // floor) instead of being thinned client-side. Pull the acted ASINs from the
    // per-user campaigns table; cap the exclusion list so the filter stays cheap.
    // Skipped in joined-only mode (that's a positive filter, not a hide).
    let excludeAsins: string[] = []
    if (!joinedOnly && (hideJoined || hidePosted)) {
      const set = new Set<string>()
      const addAsin = (v: unknown) => {
        const a = String(v || '').toUpperCase()
        if (/^[A-Z0-9]{10}$/.test(a)) set.add(a)
      }
      // Source A — the per-user campaigns table (CC-flow + deal posts carry the
      // accepted / published state here).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: acted } = await (supabase as any)
        .from('campaigns')
        .select('asin,accepted_at,status,wordpress_url')
        .eq('user_id', user.id)
        .limit(4000)
      for (const r of acted ?? []) {
        const a = String(r?.asin || '').toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(a)) continue
        if (hideJoined && r.accepted_at) set.add(a)
        if (hidePosted && r.status === 'published' && r.wordpress_url) set.add(a)
      }
      // Source B — UNIVERSAL "posted" signal. Any published blog post counts as
      // content for its product, no matter how it was made. Video-to-blog posts
      // don't create a campaigns row, but they store the resolved ASIN on the
      // linked youtube_videos row (migration 204). So: published blog_posts →
      // their videos' ASINs. This is what makes "Hide posted" catch posts made
      // outside the CC flow (the Blog Post Generator).
      if (hidePosted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: bp } = await (supabase as any)
          .from('blog_posts')
          .select('video_id')
          .eq('user_id', user.id)
          .eq('status', 'published')
          .not('video_id', 'is', null)
          .limit(4000)
        const videoIds = [...new Set((bp ?? []).map((p: { video_id?: string }) => p?.video_id).filter(Boolean))].slice(0, 2000)
        if (videoIds.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: vids } = await (supabase as any)
            .from('youtube_videos')
            .select('asin')
            .eq('user_id', user.id)
            .in('id', videoIds)
            .not('asin', 'is', null)
          for (const v of vids ?? []) addAsin(v?.asin)
        }
      }
      excludeAsins = [...set].slice(0, 3000)
    }

    // Keyword transports. The prefix tsquery hits the GIN index on search_vec and
    // matches PARTIAL words, so "humid" finds the 2,520 humidifier campaigns
    // instead of nothing. The old path was a double ILIKE, which cannot use an
    // index at all (a leading % defeats a btree) and matched whole substrings
    // only.
    const asinQ = ccAsinFromQuery(q)
    const tsq = ccTsQuery(q)
    // ILIKE fallback, kept for a database without search_vec (pre-162). Strip
    // PostgREST .or() structural chars, then the LIKE wildcards, so a typed % or
    // _ matches literally instead of silently broadening the search.
    const safeLike = q.replace(/[,()]/g, ' ').replace(/[%_\\]/g, ' ').trim()
    type Keyword = 'asin' | 'prefix' | 'ilike' | 'none'
    const firstKeyword: Keyword = !q ? 'none' : asinQ ? 'asin' : tsq ? 'prefix' : safeLike ? 'ilike' : 'none'

    // One definition of "the campaigns this request is asking about", used both
    // to fetch the ranking window and to count how many there really are. Built
    // as a function so the two never drift, and so a keyword transport the
    // database rejects can be retried on the next one down.
    //
    // `counting` swaps the row payload for a count of the matches.
    //
    // EXACT, not estimated. The estimate was tried first, on the reasoning that
    // an exact count over 918,748 rows is too much to do per keystroke, and it
    // was wrong by about half in both directions it was checked: it reported
    // 446,338 live campaigns against a true 893,644, and 2,234 matches for
    // "solar" against a true 4,140. A headline number that is half the truth is
    // worse than no headline, because a creator reads it as the catalogue being
    // short and goes looking for a missing import.
    //
    // The cost is bounded in the two shapes that matter. With a keyword the GIN
    // index narrows to a few thousand rows before anything is counted. Without
    // one, migration 326's (ends_at, commission_pct) index carries both
    // predicates, so the count is an index-only scan rather than a table read.
    // If it fails anyway the caller falls back to the estimate and SAYS it is an
    // estimate, which is the part that was missing.
    const build = (keyword: Keyword, counting: boolean, exact = true) => {
      // Cast: cc_campaign_catalog + its enrichment columns aren't in the generated
      // Supabase types, same boundary cast used across the codebase for these.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let qb = (supabase as any)
        .from('cc_campaign_catalog')
        .select(counting ? 'campaign_id' : COLS, counting ? { count: exact ? 'exact' : 'estimated', head: true } : undefined)
        .gte('ends_at', today)
        .gt('commission_pct', 0)
      if (!counting) qb = qb.limit(WINDOW)

      if (minCommission > 0) qb = qb.gte('commission_pct', minCommission)
      // In joined-only mode, positively filter to the user's accepted ASINs and
      // DON'T apply the open-spots gate (a joined campaign is worth showing even
      // when it's now full). A sentinel keeps an empty joined set matching nothing.
      if (joinedOnly) {
        qb = qb.in('rep_asin', joinedAsins.length ? joinedAsins : ['__none__'])
      } else {
        // Strict: only campaigns we KNOW have open spots (available_slot > 0).
        // A null slot count is "unknown", not "has spots", so it must NOT pass the
        // filter (this is the bulletproof behaviour — the toggle promises open spots).
        if (hasSpots) qb = qb.gt('available_slot', 0)
        // Null-safe exclusion: `rep_asin NOT IN (...)` is NULL (→ dropped) for
        // rows with a null rep_asin, which would silently hide untouched campaigns.
        // Keep null-rep_asin rows in with an explicit OR.
        if (excludeAsins.length) qb = qb.or(`rep_asin.is.null,rep_asin.not.in.(${excludeAsins.join(',')})`)
      }

      if (keyword === 'asin' && asinQ) qb = qb.contains('asins', [asinQ])
      else if (keyword === 'prefix' && tsq) qb = qb.textSearch('search_vec', tsq, { config: 'english' })
      else if (keyword === 'ilike' && safeLike) qb = qb.or(`campaign_name.ilike.%${safeLike}%,brand_name.ilike.%${safeLike}%`)

      if (counting) return qb
      // Cheap DB ordering (final ranking happens after enrichment).
      return sort === 'ending'
        ? qb.order('ends_at', { ascending: true })
        : sort === 'demand'
          // Demand = Amazon's "bought in past month" first, then FALL BACK to Keepa's
          // sales rank (lower = stronger seller) so a product with no bought-badge
          // still ranks by real demand instead of sinking. Two-key so the coarse
          // window pulls strong-rank campaigns in even when they lack a badge.
          ? qb
              .order('monthly_sold', { ascending: false, nullsFirst: false })
              .order('sales_rank', { ascending: true, nullsFirst: false })
          : qb.order('commission_pct', { ascending: false, nullsFirst: false })
    }

    let usedKeyword: Keyword = firstKeyword
    let { data, error } = await build(firstKeyword, false)
    // A pasted ASIN that matched nothing is not an error, it is the case where
    // the ASIN sits in the campaign name rather than the asins array. Try text.
    if (!error && firstKeyword === 'asin' && (data ?? []).length === 0 && tsq) {
      usedKeyword = 'prefix'
      ;({ data, error } = await build('prefix', false))
    }
    // to_tsquery rejected, or search_vec is missing (pre-162) → whole-substring
    // ILIKE. Slower and less useful, but it returns rows rather than an error.
    if (error && q && safeLike && firstKeyword !== 'ilike') {
      usedKeyword = 'ilike'
      ;({ data, error } = await build('ilike', false))
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const rows = (data ?? []) as CatalogRow[]

    // How many campaigns actually match, as opposed to how many are in the
    // ranking window. Best-effort: a failed count prints nothing rather than
    // taking the page down, and it is never allowed to be the reason a search
    // returns no results.
    //
    // Counted only on the FIRST page. Load-more re-asks the same question for
    // the same filters, so the client carries the number forward instead.
    let totalMatching: number | null = null
    let totalIsExact = false
    if (page === 1) {
      try {
        const { count, error: countErr } = await build(usedKeyword, true, true)
        if (!countErr && typeof count === 'number') { totalMatching = count; totalIsExact = true }
      } catch { /* fall through to the estimate */ }
      // Exact failed (a statement timeout on an awkward filter combination, most
      // likely). An estimate is still better than nothing, PROVIDED the page
      // says it is one. Presenting an estimate as fact is what produced "446,338
      // live campaigns" when there were 893,644.
      if (totalMatching == null) {
        try {
          const { count, error: countErr } = await build(usedKeyword, true, false)
          if (!countErr && typeof count === 'number') totalMatching = count
        } catch { /* the headline is nice to have, the campaigns are not */ }
      }
    }

    // Brand payout reliability: aggregate EVERY campaign for the brands in view
    // (not just active) so "is their budget being spent" reflects full history.
    const brands = [...new Set(rows.map((r) => (r.brand_name || '').trim()).filter(Boolean))]
    const aggByBrand = new Map<string, BrandAgg>()
    if (brands.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: brandRows } = await (supabase as any)
        .from('cc_campaign_catalog')
        .select('brand_name, budget, budget_remaining, commission_pct, ends_at')
        .in('brand_name', brands.slice(0, 300))
        // Bound the scan: this runs on every load / page / filter change. A
        // popular brand can have many historical rows; the trust aggregate is
        // fine on a capped sample and this keeps the query from scanning deep.
        .limit(8000)
      for (const b of (brandRows ?? []) as Array<{ brand_name: string | null; budget: number | null; budget_remaining: number | null; commission_pct: number | null; ends_at: string | null }>) {
        const name = (b.brand_name || '').trim()
        if (!name) continue
        let agg = aggByBrand.get(name)
        if (!agg) { agg = { brandName: name, totalCampaigns: 0, activeCampaigns: 0, totalBudget: 0, totalRemaining: 0, hasBudgetData: false, avgCommissionPct: null }; aggByBrand.set(name, agg) }
        agg.totalCampaigns++
        if (b.ends_at && b.ends_at >= today) agg.activeCampaigns++
        if (b.budget != null) { agg.hasBudgetData = true; agg.totalBudget += Number(b.budget) || 0; agg.totalRemaining += Number(b.budget_remaining ?? b.budget) || 0 }
      }
    }

    // Enrich each campaign with the decision signals + a ranking score.
    const enriched = rows.map((r) => {
      const fullness = campaignFullness(r.available_slot, r.total_slot)
      const perSale = estPerSale(r.commission_pct, r.price_now_cents)
      const daysLeft = daysUntil(r.ends_at)
      const agg = aggByBrand.get((r.brand_name || '').trim())
      const trust = brandTrust(agg ?? { brandName: r.brand_name || '', totalCampaigns: 1, activeCampaigns: 1, totalBudget: 0, totalRemaining: 0, hasBudgetData: false, avgCommissionPct: r.commission_pct })
      const score = opportunityScore({ perSale, commissionPct: r.commission_pct, trust, fullness, daysLeft, monthlySold: r.monthly_sold })
      return {
        campaignId: r.campaign_id,
        name: r.campaign_name,
        brand: r.brand_name,
        repAsin: r.rep_asin || (Array.isArray(r.asins) ? r.asins[0] : null),
        asinCount: Array.isArray(r.asins) ? r.asins.length : 0,
        image: r.image_url,
        commissionPct: r.commission_pct != null ? Number(r.commission_pct) : null,
        perSale,
        priceNow: r.price_now_cents != null ? r.price_now_cents / 100 : null,
        discountPct: r.discount_pct,
        rating: r.rating,
        reviewCount: r.review_count,
        monthlySold: r.monthly_sold,
        salesRank: r.sales_rank,
        videoCount: r.video_count,
        endsAt: r.ends_at,
        daysLeft,
        spotsLeft: fullness.spotsLeft,
        totalSlots: fullness.totalSlots,
        pctFilled: fullness.pctFilled,
        isFull: fullness.isFull,
        budgetRemaining: r.budget_remaining,
        trust: { score: trust.score, tier: trust.tier, spendRatio: trust.spendRatio, reasons: trust.reasons },
        score,
        detailsUrl: ccRequestUrl(r.campaign_id),
      }
    })

    // Final ranking (after enrichment) for the derived sorts.
    if (sort === 'score') enriched.sort((a, b) => b.score - a.score)
    else if (sort === 'perSale') enriched.sort((a, b) => (b.perSale ?? 0) - (a.perSale ?? 0))
    else if (sort === 'demand') {
      // Amazon's "bought in past month" first (a product WITH a badge always
      // outranks one without), then fall back to / tie-break on Keepa's sales
      // rank (lower number = stronger seller). Explicit re-sort so the order
      // holds regardless of how the DB returned nulls.
      enriched.sort((a, b) => {
        const am = a.monthlySold ?? -1, bm = b.monthlySold ?? -1
        if (bm !== am) return bm - am
        return (a.salesRank ?? Infinity) - (b.salesRank ?? Infinity)
      })
    }
    else if (payingOnly) { /* keep DB order */ }

    // "Paying brands only" is STRICT: it shows ONLY brands that positively read
    // as paying — tier 'reliable', exactly the ones that carry the green
    // "Pays out" badge. 'mixed', 'risky' and 'unknown' (unproven) are all hidden,
    // so a filtered card always matches its badge. (Previously this only dropped
    // 'risky', letting mixed/unknown brands through — the leak being fixed here.)
    const filtered = payingOnly ? enriched.filter((e) => e.trust.tier === 'reliable') : enriched

    // Collapse same-product campaigns (one product listed under several campaign
    // ids / marketing headlines) so the browser shows each item once — the same
    // rule the daily digest uses. Keep the highest-commission twin, then the
    // higher-scored one; preserve the current sort order otherwise.
    const groups = groupBySignals(filtered, (e) => productSignals({
      campaignId: e.campaignId, brand: e.brand, asin: e.repAsin, name: e.name,
      imageUrl: e.image, priceCents: e.priceNow != null ? Math.round(e.priceNow * 100) : null, rating: e.rating,
    }))
    const deduped = groups.map((g) => {
      let best = g[0]
      for (const e of g) {
        const cb = best.commissionPct ?? -1, ce = e.commissionPct ?? -1
        if (ce > cb || (ce === cb && e.score > best.score)) best = e
      }
      return best
    })

    const start = (page - 1) * limit
    const shown = deduped.slice(start, start + limit)

    return NextResponse.json({
      ok: true,
      campaigns: shown,
      // `total` stays the number of ranked, de-duplicated cards this request can
      // page through. It is NOT the size of the catalogue, and calling it that on
      // screen is what made a 893,644-campaign catalogue read as 219 campaigns.
      total: deduped.length,
      // What actually matches in the database, before ranking and de-duplication
      // cut it down to a window. This is the number the page leads with.
      // null on load-more pages: the client keeps the first page's figure.
      totalMatching,
      // Whether that number is counted or guessed. The page must not print a
      // planner estimate as though it were a fact.
      totalIsExact,
      nextPage: start + limit < deduped.length ? page + 1 : null,
      // True when there is more matching the filters than the ranking window
      // reads, so the cards are the best of a slice rather than the best of
      // everything. The page says so instead of implying it ranked the lot.
      windowCapped: rows.length >= WINDOW,
      windowSize: WINDOW,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
