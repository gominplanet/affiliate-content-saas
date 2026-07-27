/**
 * GET /api/deal-radar — the searchable Amazon Deal Radar feed.
 *
 * Reads the shared deal_radar_cache (populated by /api/cron/refresh-deal-radar
 * off one operator Keepa key) with filters, search, and sort. Each deal carries
 * the caller's OWN Amazon Associates tag on its product link, and — when the
 * shared Creator Connections cross-check matched — a commission badge. Page 0
 * also returns a `ticker`: the top "double-win" deals (on sale AND a bounty).
 *
 * Gate: Pro (+ admin). "Labs while we test" — NEXT_PUBLIC_DEAL_RADAR_ENABLED
 * off ⇒ admin-only; on ⇒ all Pro. Mirrors youtubeUploadEnabled/igDmEnabled.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { dealRadarEnabled } from '@/lib/feature-flags'

export const runtime = 'nodejs'

const PAGE_SIZE = 48
const TICKER_SIZE = 15

type SortKey = 'discount' | 'commission' | 'ending' | 'bestseller'

interface DealRow {
  asin: string
  title: string
  brand: string | null
  image_url: string | null
  category_id: number | null
  price_now_cents: number | null
  price_was_cents: number | null
  discount_pct: number | null
  rating: number | null
  review_count: number | null
  sales_rank: number | null
  deal_type: string
  lightning_ends_at: string | null
  campaign_id: string | null
  campaign_commission_pct: number | null
  campaign_brand: string | null
  campaign_details_url: string | null
  price_avg90_cents: number | null
  price_low_cents: number | null
  deal_quality: string | null
  lowest_label: string | null
  monthly_sold: number | null
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,amazon_associates_tag')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier

    // Pro-only, with the Labs gate: off ⇒ admin-only, on ⇒ all Pro.
    const tierOk = tier === 'pro' || tier === 'admin'
    const labsOk = dealRadarEnabled() || tier === 'admin'
    if (!tierOk || !labsOk) {
      return NextResponse.json({
        error: dealRadarEnabled()
          ? 'Amazon Deal Radar is a Pro feature.'
          : 'Amazon Deal Radar is in Labs (admin preview) right now.',
        limitReached: true, currentTier: tier,
      }, { status: 403 })
    }

    const amazonTag = ((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
    const category = intParam(url, 'category')
    const minDiscount = intParam(url, 'minDiscount')
    const minPriceCents = dollarsToCents(url.searchParams.get('minPrice'))
    const maxPriceCents = dollarsToCents(url.searchParams.get('maxPrice'))
    const minRating = floatParam(url, 'minRating')
    const minCommission = floatParam(url, 'minCommission')
    const hasCampaign = url.searchParams.get('hasCampaign') === '1' || minCommission != null
    // "Real deals only": price history confirms a genuine discount (near an
    // all-time low or meaningfully below the typical price), filtering out fake
    // % off an inflated list price.
    const realOnly = url.searchParams.get('real') === '1'
    const sort = (url.searchParams.get('sort') || 'discount') as SortKey
    const page = Math.max(0, intParam(url, 'page') ?? 0)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const build = () => {
      let query = sb.from('deal_radar_cache').select('*')
      if (q) query = query.textSearch('fts', q, { type: 'websearch', config: 'english' })
      if (category != null) query = query.eq('category_id', category)
      if (minDiscount != null) query = query.gte('discount_pct', minDiscount)
      if (minPriceCents != null) query = query.gte('price_now_cents', minPriceCents)
      if (maxPriceCents != null) query = query.lte('price_now_cents', maxPriceCents)
      if (minRating != null) query = query.gte('rating', minRating)
      if (hasCampaign) query = query.not('campaign_commission_pct', 'is', null)
      if (minCommission != null) query = query.gte('campaign_commission_pct', minCommission)
      if (realOnly) query = query.in('deal_quality', ['excellent', 'genuine'])
      return applySort(query, sort)
    }

    const from = page * PAGE_SIZE
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) {
      // textSearch against a generated `fts` column may not exist on older DBs —
      // fall back to a title ILIKE so search still works pre-migration.
      if (q) {
        let fb = sb.from('deal_radar_cache').select('*').ilike('title', `%${q}%`)
        if (category != null) fb = fb.eq('category_id', category)
        if (minDiscount != null) fb = fb.gte('discount_pct', minDiscount)
        if (hasCampaign) fb = fb.not('campaign_commission_pct', 'is', null)
        const { data: fbData } = await applySort(fb, sort).range(from, from + PAGE_SIZE - 1)
        return NextResponse.json({ ok: true, deals: (fbData ?? []).map((r: DealRow) => toClient(r, amazonTag)), ticker: [] })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const deals = (data ?? []).map((r: DealRow) => toClient(r, amazonTag))

    // Ticker (page 0 only): the double-wins — has a bounty, best commission first.
    let ticker: ReturnType<typeof toClient>[] = []
    if (page === 0) {
      const { data: tk } = await sb.from('deal_radar_cache').select('*')
        .not('campaign_commission_pct', 'is', null)
        .order('campaign_commission_pct', { ascending: false, nullsFirst: false })
        .limit(TICKER_SIZE)
      ticker = (tk ?? []).map((r: DealRow) => toClient(r, amazonTag))
    }

    return NextResponse.json({ ok: true, page, deals, ticker })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: SortKey) {
  switch (sort) {
    case 'commission': return query.order('campaign_commission_pct', { ascending: false, nullsFirst: false })
    case 'ending':     return query.order('lightning_ends_at', { ascending: true, nullsFirst: false })
    case 'bestseller': return query.order('sales_rank', { ascending: true, nullsFirst: false })
    case 'discount':
    default:           return query.order('discount_pct', { ascending: false, nullsFirst: false })
  }
}

function toClient(r: DealRow, amazonTag: string) {
  const base = `https://www.amazon.com/dp/${r.asin}`
  const amazonUrl = amazonTag ? `${base}?tag=${encodeURIComponent(amazonTag)}` : base
  return {
    asin: r.asin,
    title: r.title,
    brand: r.brand,
    imageUrl: r.image_url,
    categoryId: r.category_id,
    priceNow: centsToNum(r.price_now_cents),
    priceWas: centsToNum(r.price_was_cents),
    discountPct: r.discount_pct,
    rating: r.rating != null ? Number(r.rating) : null,
    reviewCount: r.review_count,
    monthlySold: r.monthly_sold,
    dealType: r.deal_type,
    lightningEndsAt: r.lightning_ends_at,
    amazonUrl,
    campaign: r.campaign_commission_pct != null ? {
      commissionPct: Number(r.campaign_commission_pct),
      brand: r.campaign_brand,
      detailsUrl: r.campaign_details_url,
    } : null,
    verdict: r.deal_quality ? {
      quality: r.deal_quality,          // excellent | genuine | fair | weak
      label: r.lowest_label,            // "All-time low" / "32% below its usual price"
      typical: centsToNum(r.price_avg90_cents),
      allTimeLow: centsToNum(r.price_low_cents),
    } : null,
  }
}

function intParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key)
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}
function floatParam(url: URL, key: string): number | null {
  const v = url.searchParams.get(key)
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function dollarsToCents(v: string | null): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
function centsToNum(cents: number | null): number | null {
  return cents == null ? null : Math.round(cents) / 100
}
