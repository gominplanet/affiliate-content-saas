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
import { canUseDealRadar } from '@/lib/feature-access'

export const runtime = 'nodejs'

const PAGE_SIZE = 48
const TICKER_SIZE = 15

type SortKey = 'opportunity' | 'discount' | 'commission' | 'ending' | 'bestseller'

/**
 * Rough Amazon Associates category commission rates (US), keyed by the Keepa
 * root browse-node ids we sweep. Rates change + vary by sub-category, so this is
 * a labelled ESTIMATE only. Creator Connections deals override this with the
 * campaign's actual bounty rate. Default 3% for anything unmapped.
 */
const AMAZON_RATE_BY_CATEGORY: Record<number, number> = {
  172282: 2,      // Electronics
  1055398: 3,     // Home & Kitchen
  3375251: 3,     // Sports & Outdoors
  3760901: 2,     // Health & Household
  3760911: 3,     // Beauty
  228013: 5,      // Tools & Home Improvement
  165793011: 3,   // Toys & Games
  2619533011: 3,  // Pet Supplies
  1064954: 3,     // Office
  15684181: 4.5,  // Automotive
  165796011: 3,   // Baby
  7141123011: 4,  // Clothing, Shoes & Jewelry
  541966: 2.5,    // Computers
  2335752011: 3,  // Cell Phones
  16310101: 1,    // Grocery
  11091801: 3,    // Musical Instruments
  2972638011: 3,  // Patio, Lawn & Garden
  468642: 1,      // Video Games
}
const DEFAULT_AMAZON_RATE = 3

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
  opportunity_score: number | null
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

    // Open to all paid tiers (creator/studio/pro/admin). Single source of truth.
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({
        error: 'Amazon Deal Radar is available on paid plans.',
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
    const lightningOnly = url.searchParams.get('lightning') === '1'
    const sort = (url.searchParams.get('sort') || 'opportunity') as SortKey
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
      // Lightning tab shows only deals whose window is STILL LIVE. An expired
      // lightning deal is no longer "hurry, it ends soon!" — it shouldn't fill
      // this tab with dead "Deal ended" cards.
      if (lightningOnly) query = query.eq('deal_type', 'lightning').gt('lightning_ends_at', new Date().toISOString())
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

    const rows = (data ?? []) as DealRow[]

    // Ticker (page 0 only): the double-wins — has a bounty, best commission first.
    let tickerRows: DealRow[] = []
    if (page === 0) {
      const { data: tk } = await sb.from('deal_radar_cache').select('*')
        .not('campaign_commission_pct', 'is', null)
        .order('campaign_commission_pct', { ascending: false, nullsFirst: false })
        .limit(TICKER_SIZE)
      tickerRows = (tk ?? []) as DealRow[]
    }

    // Which of these ASINs has this user ALREADY turned into a deal blog post?
    // (blog_posts.deal_meta->>'asin'). We annotate each card with its post URL so
    // the UI can show "Posted" + a link, rather than tempting a duplicate.
    const asins = [...new Set([...rows, ...tickerRows].map((r) => r.asin))]
    const postedByAsin = await fetchPostedByAsin(sb, user.id, asins)

    const deals = rows.map((r) => toClient(r, amazonTag, postedByAsin.get(r.asin) || null))
    const ticker = tickerRows.map((r) => toClient(r, amazonTag, postedByAsin.get(r.asin) || null))

    return NextResponse.json({ ok: true, page, deals, ticker })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** Map ASIN → the user's existing deal-post URL, for the ASINs on this page.
 *  Sourced from blog_posts.deal_meta->>'asin' (deal posts store the ASIN there).
 *  Best-effort: returns an empty map on any error so the feed never breaks. */
async function fetchPostedByAsin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, userId: string, asins: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!asins.length) return out
  const want = new Set(asins.map((a) => a.toUpperCase()))
  try {
    // Single deal posts store one ASIN at deal_meta->>asin.
    const { data } = await sb
      .from('blog_posts')
      .select('wordpress_url, deal_meta')
      .eq('user_id', userId)
      .eq('post_type', 'deal')
      .in('deal_meta->>asin', asins)
    for (const row of (data ?? []) as Array<{ wordpress_url: string | null; deal_meta: { asin?: string } | null }>) {
      const a = (row.deal_meta?.asin || '').toUpperCase()
      if (a && row.wordpress_url && !out.has(a)) out.set(a, row.wordpress_url)
    }
    // Roundup posts store every included ASIN at deal_meta->asins (an array), so
    // each product in a roundup is also flagged as already-posted.
    const { data: rounds } = await sb
      .from('blog_posts')
      .select('wordpress_url, deal_meta')
      .eq('user_id', userId)
      .eq('post_type', 'deal')
      .not('deal_meta->asins', 'is', null)
    for (const row of (rounds ?? []) as Array<{ wordpress_url: string | null; deal_meta: { asins?: unknown } | null }>) {
      const arr = Array.isArray(row.deal_meta?.asins) ? row.deal_meta!.asins as unknown[] : []
      for (const raw of arr) {
        const a = String(raw).toUpperCase()
        if (want.has(a) && row.wordpress_url && !out.has(a)) out.set(a, row.wordpress_url)
      }
    }
  } catch { /* deal_meta column absent / query error — no "posted" badges this run */ }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: SortKey) {
  switch (sort) {
    case 'opportunity': return query.order('opportunity_score', { ascending: false, nullsFirst: false })
    case 'commission': return query.order('campaign_commission_pct', { ascending: false, nullsFirst: false })
    case 'ending':     return query.order('lightning_ends_at', { ascending: true, nullsFirst: false })
    // "Best sellers" = real popularity. sales_rank is CATEGORY-relative (a #100
    // in a tiny niche outranks a #5000 in Electronics that sells 100× more), so
    // it surfaced niche junk. Use absolute, cross-category signals instead:
    // Amazon's monthly units-sold first (sparse but authoritative), then total
    // review count (dense proxy for popularity) as the tiebreak.
    case 'bestseller': return query
      .order('monthly_sold', { ascending: false, nullsFirst: false })
      .order('review_count', { ascending: false, nullsFirst: false })
    case 'discount':
    default:           return query.order('discount_pct', { ascending: false, nullsFirst: false })
  }
}

function toClient(r: DealRow, amazonTag: string, postedUrl: string | null = null) {
  const base = `https://www.amazon.com/dp/${r.asin}`
  const amazonUrl = amazonTag ? `${base}?tag=${encodeURIComponent(amazonTag)}` : base

  // Estimated commission per sale. A Creator Connections bounty (when present) is
  // the real rate; otherwise a rough Amazon category rate. Labelled "est" client-
  // side. Null when we have no price to base it on.
  const bountyRate = r.campaign_commission_pct != null ? Number(r.campaign_commission_pct) : null
  const rate = bountyRate ?? (r.category_id != null ? (AMAZON_RATE_BY_CATEGORY[r.category_id] ?? DEFAULT_AMAZON_RATE) : DEFAULT_AMAZON_RATE)
  const estCommissionCents = r.price_now_cents != null ? Math.round(r.price_now_cents * (rate / 100)) : null

  // A lightning deal whose window has passed is no longer a lightning deal —
  // strip the badge + countdown so it doesn't show "Lightning / Deal ended".
  // If its price is still good it simply lives on as a normal price-drop deal.
  const lightningExpired = r.deal_type === 'lightning' && r.lightning_ends_at != null
    && new Date(r.lightning_ends_at).getTime() <= Date.now()

  return {
    postedUrl,
    estCommissionCents,
    commissionRatePct: rate,
    commissionIsBounty: bountyRate != null,
    opportunityScore: r.opportunity_score != null ? Number(r.opportunity_score) : null,
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
    dealType: lightningExpired ? 'price_drop' : r.deal_type,
    lightningEndsAt: lightningExpired ? null : r.lightning_ends_at,
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
