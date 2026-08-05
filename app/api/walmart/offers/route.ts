/**
 * GET /api/walmart/offers — browse the FULL Walmart offers catalog (not just the
 * brands you've joined) through MVP's rulebook. Reads the PartnerBoost REST
 * datafeed (get_products), then gates + ranks each offer with the same
 * PartnerBoost rulebook the Finder uses: price band, commission floor, category
 * bans, ranked by estimated $/sale. Read-only.
 *
 * Open to every signed-in tier (gated by the user's own PartnerBoost token).
 * Generating a post still runs the paid + WordPress gates in /api/walmart/generate.
 *
 * The datafeed pages 50 at a time and filters server-side only by brand /
 * relationship, so MVP scans a few pages and applies its own filters app-side,
 * returning a nextPage cursor to keep loading.
 *
 * Query: page (start, default 1), mode (focus|wide), q (keyword), brandId,
 *        relationship (0|1|2), limit (target matches 10-50, default 24).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWalmartOffers, type PBWalmartOffer } from '@/services/partnerboost'
import { getExternalKey } from '@/lib/external-keys'
import { pbRules, isAvoidedPb, scorePb, type PbRuleMode, type PbCandidate } from '@/lib/partnerboost-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_PAGES_PER_CALL = 6 // scan at most this many datafeed pages per request

function toCandidate(o: PBWalmartOffer): PbCandidate {
  const priceNum = o.price != null && o.price !== '' && isFinite(Number(o.price)) ? Number(o.price) : null
  return {
    key: o.itemId || o.sku || o.url,
    name: o.name,
    priceNum,
    price: o.price,
    commissionPct: o.commissionPct,
    flatPayout: null,
    image: o.image,
    url: o.url,
    category: o.category,
    brandName: o.brand,
    brandCategories: o.category,
    brandId: o.brandId,
    brandMcid: o.mcid,
    network: 'Walmart',
    sku: o.sku ?? o.itemId,
    trackingUrl: o.trackingUrl,
    brandTrackingUrl: '',
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })
    }

    const { searchParams } = new URL(request.url)
    const startPage = Math.max(Number(searchParams.get('page')) || 1, 1)
    const mode: PbRuleMode = searchParams.get('mode') === 'wide' ? 'wide' : 'focus'
    const rules = pbRules(mode)
    const q = (searchParams.get('q') || '').trim().toLowerCase()
    const brandId = searchParams.get('brandId') || undefined
    const relRaw = searchParams.get('relationship')
    const relationship = relRaw != null && relRaw !== '' ? Number(relRaw) : undefined
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 24, 10), 50)
    // Optional "price drops" mode: keep only offers marked down at least this
    // much, ranked by discount instead of estimated payout.
    const minDiscount = Number(searchParams.get('minDiscount')) || 0
    const sortBy = searchParams.get('sort') === 'discount' ? 'discount' : 'payout'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = []
    let scanned = 0
    let page = startPage
    let hasMore = false
    let pagesScanned = 0

    while (pagesScanned < MAX_PAGES_PER_CALL && matches.length < limit) {
      const { offers, hasMore: more } = await getWalmartOffers(token, {
        page, pageSize: 50, relationship, brandId, keyword: q || undefined,
      })
      pagesScanned++
      scanned += offers.length
      hasMore = more
      for (const o of offers) {
        const c = toCandidate(o)
        if (!c.name || !c.url) continue
        if (c.priceNum == null || c.priceNum < rules.minPrice || c.priceNum > rules.maxPrice) continue
        // Per-product commission gate (offers carry their own rate, unlike the
        // brand-level finder). Unknown commission is allowed through.
        if (c.commissionPct != null && c.commissionPct < rules.minCommissionPct) continue
        if (isAvoidedPb(c, rules)) continue
        if (q && !`${c.name} ${c.category || ''}`.toLowerCase().includes(q)) continue
        if (minDiscount > 0 && (o.discountPct == null || o.discountPct < minDiscount)) continue
        const scored = scorePb(c)
        matches.push({
          key: scored.key, itemId: o.itemId, name: scored.name,
          price: scored.price, priceNum: scored.priceNum, oldPrice: o.oldPrice,
          commissionPct: scored.commissionPct, perSale: scored.perSale,
          discountPct: o.discountPct, rating: o.rating, ratingsTotal: o.ratingsTotal,
          image: scored.image, url: scored.url, category: scored.category,
          brandName: scored.brandName, sku: scored.sku, trackingUrl: scored.trackingUrl,
        })
      }
      page++
      if (!more) break
    }

    // perSale can be null (offer with unknown commission) — coalesce to 0 so the
    // comparator never returns NaN (which corrupts the sort order).
    if (sortBy === 'discount') {
      matches.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0) || (b.perSale ?? 0) - (a.perSale ?? 0))
    } else {
      matches.sort((a, b) => (b.perSale ?? 0) - (a.perSale ?? 0) || (b.commissionPct ?? 0) - (a.commissionPct ?? 0))
    }

    const shown = matches.slice(0, limit)
    // Which of these item ids has the user already turned into a post? (a single
    // Walmart post stamps deal_meta.itemId; a roundup stamps deal_meta.itemIds).
    const posted = await fetchWalmartPosted(supabase, user.id, shown.map((m) => m.itemId))
    for (const m of shown) m.posted = posted.get(m.itemId) || null

    return NextResponse.json({
      ok: true,
      matches: shown,
      scanned,
      nextPage: hasMore ? page : null,
      ...(matches.length === 0 ? { note: 'No Walmart offers in this batch cleared the MVP criteria. Try a different keyword, or load more.' } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'PartnerBoost request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

/** Map Walmart item id → the user's existing post URL, for the shown items.
 *  A single Walmart post stamps deal_meta.itemId (kind:'walmart'); a roundup
 *  stamps deal_meta.itemIds (kind:'walmart_roundup'). Best-effort — returns an
 *  empty map on any error so the feed never breaks. */
async function fetchWalmartPosted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string, itemIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(itemIds.filter(Boolean))]
  if (!ids.length) return out
  const want = new Set(ids)
  try {
    const { data: singles } = await supabase
      .from('blog_posts')
      .select('wordpress_url, deal_meta')
      .eq('user_id', userId)
      .eq('deal_meta->>kind', 'walmart')
      .in('deal_meta->>itemId', ids)
    for (const row of (singles ?? []) as Array<{ wordpress_url: string | null; deal_meta: { itemId?: string } | null }>) {
      const id = String(row.deal_meta?.itemId || '')
      if (id && row.wordpress_url && !out.has(id)) out.set(id, row.wordpress_url)
    }
    const { data: rounds } = await supabase
      .from('blog_posts')
      .select('wordpress_url, deal_meta')
      .eq('user_id', userId)
      .eq('deal_meta->>kind', 'walmart_roundup')
    for (const row of (rounds ?? []) as Array<{ wordpress_url: string | null; deal_meta: { itemIds?: unknown } | null }>) {
      const arr = Array.isArray(row.deal_meta?.itemIds) ? row.deal_meta!.itemIds as unknown[] : []
      for (const raw of arr) {
        const id = String(raw)
        if (want.has(id) && row.wordpress_url && !out.has(id)) out.set(id, row.wordpress_url)
      }
    }
  } catch { /* deal_meta column absent / query error — no badges this run */ }
  return out
}
