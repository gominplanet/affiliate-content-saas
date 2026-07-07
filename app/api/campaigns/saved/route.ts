// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The "Saved for later" shelf under the MVP Finder (migration 163).
//   GET    → list the user's saved finds (newest first)
//   POST   → save one find (upsert on user+asin, so re-saving is a no-op)
//   DELETE → remove one (?id= or ?asin=)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'

const COLS = 'id, asin, source, campaign_id, title, brand, image_url, commission_pct, price, monthly_sales, rating, has_video, marketplace, details_url, created_at'

// The saved shelf lives under the AMZ Product Finder (Source & Earn) — Studio +
// Pro only. RLS already scopes rows to the owner; this gate matches the UI so
// Creator / Trial can't reach the shelf at all. 2026-07-07.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finderTierOk(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  return tierAllowsFinders((data?.tier as Tier) ?? 'trial')
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await finderTierOk(supabase, user.id))) return NextResponse.json({ ok: false, error: 'The AMZ Product Finder requires a Studio or Pro plan.', saved: [] }, { status: 403 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cc_saved_finds').select(COLS)
    .in('source', ['campaign', 'onsite']) // Levanta finds live in their own shelf (/api/levanta/saved)
    .order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.message, saved: [] }, { status: 200 })
  return NextResponse.json({ ok: true, saved: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await finderTierOk(supabase, user.id))) return NextResponse.json({ error: 'The AMZ Product Finder requires a Studio or Pro plan.' }, { status: 403 })

  const b = await request.json().catch(() => ({}))
  const asin = String(b.asin || '').toUpperCase().trim()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'valid asin required' }, { status: 400 })

  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)
  const row = {
    user_id: user.id,
    asin,
    source: b.source === 'onsite' ? 'onsite' : 'campaign',
    campaign_id: b.campaignId ? String(b.campaignId).slice(0, 120) : null,
    title: b.title ? String(b.title).slice(0, 400) : null,
    brand: b.brand ? String(b.brand).slice(0, 200) : null,
    image_url: b.imageUrl ? String(b.imageUrl).slice(0, 1000) : null,
    commission_pct: num(b.commissionPct),
    price: num(b.price),
    monthly_sales: num(b.monthlySales),
    rating: num(b.rating),
    has_video: typeof b.hasVideo === 'boolean' ? b.hasVideo : null,
    marketplace: b.marketplace ? String(b.marketplace).slice(0, 8) : 'us',
    details_url: b.detailsUrl ? String(b.detailsUrl).slice(0, 1000) : null,
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
  if (!(await finderTierOk(supabase, user.id))) return NextResponse.json({ error: 'The AMZ Product Finder requires a Studio or Pro plan.' }, { status: 403 })
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const asin = (url.searchParams.get('asin') || '').toUpperCase()
  if (!id && !asin) return NextResponse.json({ error: 'id or asin required' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('cc_saved_finds').delete()
  q = id ? q.eq('id', id) : q.eq('asin', asin)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
