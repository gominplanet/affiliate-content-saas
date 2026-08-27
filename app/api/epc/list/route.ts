/**
 * GET /api/epc/list — the signed-in creator's EPC / Sponsored-Products library.
 *   ?q=          search over product title + brand
 *   ?sort=       recent (default) | epc | rating | price_low | price_high |
 *                sold (most bought) | rank (best-selling) | discount (biggest deal)
 *   ?onSale=     1 → only products currently below their usual price
 *   ?minDiscount= only products at least N% below their 90-day average
 *   ?minSold=    only products with at least N/month bought
 *   ?maxPrice=   only products at/under this price (dollars)
 *   ?minRating=  only products at/above this star rating
 *   ?budget=     High | Medium | Low  (Amazon's budget-availability score)
 *   ?limit=      default 60, max 200
 *   ?offset=     pagination
 * Returns: { ok, products, total }.
 *
 * DELETE /api/epc/list?asin=XXXXXXXXXX — remove one product from the library.
 *
 * RLS restricts every row to the owner, so no explicit user filter is needed for
 * safety — we add one anyway so the count + query are tight.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SORTS: Record<string, { col: string; asc: boolean }> = {
  recent: { col: 'scanned_at', asc: false },
  epc: { col: 'epc_value', asc: false },
  rating: { col: 'rating', asc: false },
  price_low: { col: 'price_cents', asc: true },
  price_high: { col: 'price_cents', asc: false },
  sold: { col: 'monthly_sold', asc: false },       // most bought / month
  rank: { col: 'sales_rank', asc: true },           // best-selling (lower rank = better)
  discount: { col: 'discount_pct', asc: false },    // biggest price drop vs usual
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const p = url.searchParams
  const q = (p.get('q') || '').trim().replace(/[,%]/g, ' ').slice(0, 80)
  const sortKey = p.get('sort') || 'recent'
  const sort = SORTS[sortKey] || SORTS.recent
  const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 60))
  const offset = Math.max(0, Number(p.get('offset')) || 0)
  // Filters (all optional; ignored when absent/blank).
  const onSale = p.get('onSale') === '1'
  const minDiscount = Math.max(0, Math.min(99, Number(p.get('minDiscount')) || 0))
  const minSold = Math.max(0, Number(p.get('minSold')) || 0)
  const maxPriceCents = p.get('maxPrice') ? Math.round(Math.max(0, Number(p.get('maxPrice')) || 0) * 100) : 0
  const minRating = Math.max(0, Math.min(5, Number(p.get('minRating')) || 0))
  const budget = (p.get('budget') || '').trim()

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('epc_products')
      // select('*') so a DB missing the Keepa-enrich columns (migration 279/287)
      // can't fail the whole read — it returns whatever columns exist.
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
    if (q) query = query.or(`title.ilike.%${q}%,brand.ilike.%${q}%`)
    // A discount filter (onSale or minDiscount) needs a real, positive discount.
    if (onSale && minDiscount < 1) query = query.gte('discount_pct', 1)
    if (minDiscount >= 1) query = query.gte('discount_pct', minDiscount)
    if (minSold >= 1) query = query.gte('monthly_sold', minSold)
    if (maxPriceCents >= 1) query = query.lte('price_cents', maxPriceCents)
    if (minRating > 0) query = query.gte('rating', minRating)
    if (budget === 'High' || budget === 'Medium' || budget === 'Low') query = query.eq('budget', budget)
    query = query
      .order(sort.col, { ascending: sort.asc, nullsFirst: false })
      .order('scanned_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) {
      console.error('[epc/list]', error.message)
      return NextResponse.json({ ok: true, products: [], total: 0 })
    }
    // Newest scanned_at across the whole (unfiltered) library — powers the "refresh
    // the catalogue" nudge. Cheap: one indexed row read. Best-effort.
    let newestScan: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newest } = await (supabase as any)
        .from('epc_products').select('scanned_at').eq('user_id', user.id)
        .order('scanned_at', { ascending: false }).limit(1).maybeSingle()
      newestScan = newest?.scanned_at ?? null
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, products: data ?? [], total: count ?? 0, newestScan })
  } catch (err) {
    console.error('[epc/list]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: true, products: [], total: 0 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('epc_products').delete().eq('user_id', user.id).eq('asin', asin)
  if (error) return NextResponse.json({ error: 'Could not remove that product.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
