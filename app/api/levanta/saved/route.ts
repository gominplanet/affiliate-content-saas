// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Saved for later" shelf for the Levanta MVP Finder. Reuses the shared
// cc_saved_finds table (migration 163) with source='levanta' — no new
// migration. Kept separate from /api/campaigns/saved so the Amazon shelf and
// the Levanta shelf never show each other's items.
//   GET    → list the user's saved Levanta finds (newest first)
//   POST   → save one (upsert on user+asin; re-saving is a no-op)
//   DELETE → remove one (?id= or ?asin=)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const COLS = 'id, asin, title, brand, image_url, commission_pct, price, rating, marketplace, created_at'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_saved_finds').select(COLS)
    .eq('source', 'levanta')
    .order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.message, saved: [] }, { status: 200 })
  return NextResponse.json({ ok: true, saved: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const asin = String(b.asin || '').toUpperCase().trim()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'valid asin required' }, { status: 400 })

  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)
  const row = {
    user_id: user.id,
    asin,
    source: 'levanta',
    title: b.title ? String(b.title).slice(0, 400) : null,
    brand: b.brand ? String(b.brand).slice(0, 200) : null,
    image_url: b.imageUrl ? String(b.imageUrl).slice(0, 1000) : null,
    commission_pct: num(b.commissionPct),
    price: num(b.price),
    rating: num(b.rating),
    // Levanta marketplaces are full hosts ('amazon.com', 'amazon.co.uk') — the
    // column is plain text, so store it whole (the CC route's 8-char cap is a
    // 'us'/'ca'/'uk' thing that doesn't apply here).
    marketplace: b.marketplace ? String(b.marketplace).slice(0, 32) : 'amazon.com',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_saved_finds')
    .upsert(row, { onConflict: 'user_id,asin' })
    .select('id, asin').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data?.id, asin })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const asin = (url.searchParams.get('asin') || '').toUpperCase()
  if (!id && !asin) return NextResponse.json({ error: 'id or asin required' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('cc_saved_finds').delete().eq('source', 'levanta')
  q = id ? q.eq('id', id) : q.eq('asin', asin)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
