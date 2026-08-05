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
import { type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

// Coarse DB window we pull before computing scores + paginating in-process.
// Keeps the "best opportunities" browser fast without loading the whole catalog.
const WINDOW = 300

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
  video_count: number | null
}

const COLS = 'campaign_id, campaign_name, brand_name, asins, rep_asin, commission_pct, starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, image_url, price_now_cents, price_was_cents, discount_pct, rating, review_count, monthly_sold, video_count'

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
    const today = new Date().toISOString().slice(0, 10)

    // "Hide joined / Hide posted" — exclude this user's already-acted ASINs from
    // the query itself, so the coarse window fills with FRESH campaigns (a real
    // floor) instead of being thinned client-side. Pull the acted ASINs from the
    // per-user campaigns table; cap the exclusion list so the filter stays cheap.
    let excludeAsins: string[] = []
    if (hideJoined || hidePosted) {
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

    // Coarse fetch: live campaigns, ordered by a cheap proxy for the chosen sort.
    // Cast: cc_campaign_catalog + its enrichment columns aren't in the generated
    // Supabase types, same boundary cast used across the codebase for these.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('cc_campaign_catalog')
      .select(COLS)
      .gte('ends_at', today)
      .gt('commission_pct', 0)
      .limit(WINDOW)

    if (minCommission > 0) query = query.gte('commission_pct', minCommission)
    if (hasSpots) query = query.or('available_slot.is.null,available_slot.gt.0')
    if (excludeAsins.length) query = query.not('rep_asin', 'in', `(${excludeAsins.join(',')})`)
    if (q) {
      const safe = q.replace(/[,()]/g, ' ').trim()
      if (safe) query = query.or(`campaign_name.ilike.%${safe}%,brand_name.ilike.%${safe}%`)
    }
    // Cheap DB ordering (final ranking happens after enrichment).
    query = sort === 'ending'
      ? query.order('ends_at', { ascending: true })
      : sort === 'demand'
        ? query.order('monthly_sold', { ascending: false, nullsFirst: false })
        : query.order('commission_pct', { ascending: false, nullsFirst: false })

    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const rows = (data ?? []) as CatalogRow[]

    // Brand payout reliability: aggregate EVERY campaign for the brands in view
    // (not just active) so "is their budget being spent" reflects full history.
    const brands = [...new Set(rows.map((r) => (r.brand_name || '').trim()).filter(Boolean))]
    const aggByBrand = new Map<string, BrandAgg>()
    if (brands.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: brandRows } = await (supabase as any)
        .from('cc_campaign_catalog')
        .select('brand_name, budget, budget_remaining, commission_pct, ends_at')
        .in('brand_name', brands)
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
    else if (payingOnly) { /* keep DB order */ }

    // "Paying brands only" hides brands we can POSITIVELY prove aren't paying —
    // budget committed but sitting unspent → 'risky'. Brands we simply can't
    // judge (no budget data → 'unknown') stay visible: we never blank the page
    // on a signal we don't have. Today the catalog carries budget_remaining but
    // no total `budget`, so nothing scores 'risky' yet and this is a soft filter;
    // once total-budget data flows in it starts excluding proven non-spenders.
    const filtered = payingOnly ? enriched.filter((e) => e.trust.tier !== 'risky') : enriched
    const start = (page - 1) * limit
    const shown = filtered.slice(start, start + limit)

    return NextResponse.json({
      ok: true,
      campaigns: shown,
      total: filtered.length,
      nextPage: start + limit < filtered.length ? page + 1 : null,
      windowCapped: rows.length >= WINDOW,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
