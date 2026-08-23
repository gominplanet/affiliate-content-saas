/**
 * GET /api/epc/list — the signed-in creator's EPC / Sponsored-Products library.
 *   ?q=       search over product title + brand
 *   ?sort=    recent (default) | epc | rating | price_low
 *   ?limit=   default 60, max 200
 *   ?offset=  pagination
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
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') || '').trim().replace(/[,%]/g, ' ').slice(0, 80)
  const sortKey = url.searchParams.get('sort') || 'recent'
  const sort = SORTS[sortKey] || SORTS.recent
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('epc_products')
      .select('asin,title,brand,image_url,price_cents,epc_value,epc_display,budget,rating,ends_at,details_url,scanned_at,first_seen_at', { count: 'exact' })
      .eq('user_id', user.id)
    if (q) query = query.or(`title.ilike.%${q}%,brand.ilike.%${q}%`)
    query = query
      .order(sort.col, { ascending: sort.asc, nullsFirst: false })
      .order('scanned_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) {
      console.error('[epc/list]', error.message)
      return NextResponse.json({ ok: true, products: [], total: 0 })
    }
    return NextResponse.json({ ok: true, products: data ?? [], total: count ?? 0 })
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
