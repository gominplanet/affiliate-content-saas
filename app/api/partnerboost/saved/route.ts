// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Saved for later" shelf for the PartnerBoost MVP Finder. Reuses the shared
// cc_saved_finds table (migration 163) with source='partnerboost' — no new
// migration. Unlike Amazon/Levanta, PartnerBoost products have NO 10-char ASIN
// (Walmart/DTC are URL-keyed), so the `asin` column holds an arbitrary product
// key (sku, else the product URL); we don't apply the ASIN-format check here.
//   GET / POST / DELETE (?id= or ?key=)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// campaign_id / notes are repurposed to carry the two deep-link bases so the
// shelf's "Generate post" stays monetized (PB has no ASIN to re-fetch from).
const COLS = 'id, asin, title, brand, image_url, commission_pct, price, marketplace, details_url, campaign_id, notes, created_at'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_saved_finds').select(COLS)
    .eq('source', 'partnerboost')
    .order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.message, saved: [] }, { status: 200 })
  return NextResponse.json({ ok: true, saved: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const key = String(b.key || '').trim()
  if (!key || key.length > 1000) return NextResponse.json({ error: 'valid product key required' }, { status: 400 })

  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)
  const row = {
    user_id: user.id,
    asin: key,               // arbitrary product key (sku / URL) — text column, no format constraint
    source: 'partnerboost',
    title: b.title ? String(b.title).slice(0, 400) : null,
    brand: b.brand ? String(b.brand).slice(0, 200) : null,
    image_url: b.imageUrl ? String(b.imageUrl).slice(0, 1000) : null,
    commission_pct: num(b.commissionPct),
    price: num(b.price),
    marketplace: b.network ? String(b.network).slice(0, 32) : null, // Walmart / Amazon / DTC
    details_url: b.url ? String(b.url).slice(0, 1000) : null,       // product page — Buy to review
    campaign_id: b.brandTrackingUrl ? String(b.brandTrackingUrl).slice(0, 1000) : null, // brand deep-link base
    notes: b.trackingUrl ? String(b.trackingUrl).slice(0, 1000) : null,                 // product's own tracking link
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_saved_finds')
    .upsert(row, { onConflict: 'user_id,asin' })
    .select('id, asin').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id, key })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const key = url.searchParams.get('key')
  if (!id && !key) return NextResponse.json({ error: 'id or key required' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('cc_saved_finds').delete().eq('source', 'partnerboost')
  q = id ? q.eq('id', id) : q.eq('asin', key)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
