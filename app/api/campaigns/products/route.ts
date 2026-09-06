// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/products   { asins: string[] }
//
// Names and pictures for the products a campaign covers, so the creator can pick
// one instead of MVP picking for them.
//
// A Creator Connections campaign can span a dozen products. MVP's card shows the
// campaign's representative ASIN, which is Amazon's rep_asin where there is one
// and otherwise simply the first entry in the list, an arbitrary choice nobody
// made on purpose. Writing about it silently is the part that needed fixing, and
// a picker showing ten raw ASINs would barely be an improvement, so this fills in
// what is known about each.
//
// Only the shared caches are read, never Amazon. A product nothing has looked up
// yet comes back with its id and nothing else, which is honest: the picker shows
// the ones it can describe and leaves the rest as ids rather than inventing
// details for them.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface CampaignProduct {
  asin: string
  title: string | null
  imageUrl: string | null
  priceCents: number | null
  rating: number | null
  reviewCount: number | null
  monthlySold: number | null
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const body = await request.json().catch(() => ({})) as { asins?: string[] }
    const asins = [...new Set((body.asins ?? [])
      .map(a => String(a || '').toUpperCase())
      .filter(a => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 30)
    if (!asins.length) return NextResponse.json({ products: [] as CampaignProduct[] })

    const out = new Map<string, CampaignProduct>(
      asins.map(a => [a, { asin: a, title: null, imageUrl: null, priceCents: null, rating: null, reviewCount: null, monthlySold: null }]))

    // Keepa's shared cache first: it is keyed by ASIN and carries the picture and
    // the price history that make one product distinguishable from another.
    try {
      const { data } = await sb.from('keepa_product_cache')
        .select('asin, image_url, price_now_cents, monthly_sold, empty').in('asin', asins)
      for (const k of (data ?? []) as Array<{ asin: string; image_url: string | null; price_now_cents: number | null; monthly_sold: number | null; empty: boolean | null }>) {
        if (k.empty) continue
        const row = out.get(String(k.asin || '').toUpperCase())
        if (!row) continue
        row.imageUrl = k.image_url ?? null
        row.priceCents = k.price_now_cents ?? null
        row.monthlySold = k.monthly_sold ?? null
      }
    } catch { /* nothing cached, so the picker shows ids */ }

    // The creator's own catalog rows, which carry a real product title where a
    // post or a research pass has already named the thing.
    try {
      const { data } = await sb.from('epc_catalog')
        .select('asin, title, image_url, price_cents, rating').in('asin', asins)
      for (const e of (data ?? []) as Array<{ asin: string; title: string | null; image_url: string | null; price_cents: number | null; rating: number | null }>) {
        const row = out.get(String(e.asin || '').toUpperCase())
        if (!row) continue
        row.title = row.title ?? e.title ?? null
        row.imageUrl = row.imageUrl ?? e.image_url ?? null
        row.priceCents = row.priceCents ?? e.price_cents ?? null
        row.rating = e.rating ?? null
      }
    } catch { /* the catalog may not carry these columns on an older database */ }

    return NextResponse.json({ products: asins.map(a => out.get(a) as CampaignProduct) })
  } catch {
    return NextResponse.json({ products: [] as CampaignProduct[] })
  }
}
