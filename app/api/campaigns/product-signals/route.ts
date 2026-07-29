// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/product-signals  { signals: [{ asin, image?, price?, rating?, monthlySales?, hasVideo? }] }
//
// Caches the product signals SCOUT already resolves during a Smart Scan (image,
// price, rating, recent sales, carousel-video presence) onto the shared Creator
// Connections catalog, keyed by the campaign's representative product (rep_asin).
// The Browse view then shows those cards image-rich — sourced from SCOUT (the
// finder's native, per-user, no-operator-cost data source), NOT Keepa.
//
// Writes the shared catalog, so once a creator scans a product every viewer
// benefits. Service-role write (catalog is service-role only); best-effort.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Sig { asin?: string; image?: string | null; price?: number | null; rating?: number | null; monthlySales?: number | null; hasVideo?: boolean | null }

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) return NextResponse.json({ ok: true, cached: 0 })

  const body = await request.json().catch(() => ({})) as { signals?: Sig[] }
  const seen = new Set<string>()
  const rows = (body.signals ?? [])
    .map(s => {
      const asin = String(s.asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return null
      seen.add(asin)
      return { asin, s }
    })
    .filter((x): x is { asin: string; s: Sig } => x !== null)
    .slice(0, 60)
  if (!rows.length) return NextResponse.json({ ok: true, cached: 0 })

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  let cached = 0
  // One UPDATE per rep_asin (updates every campaign sharing that product). Only
  // write columns SCOUT actually knows; leave the rest (review_count, price_was,
  // discount) null — this isn't a deals surface.
  for (const { asin, s } of rows) {
    const patch: Record<string, unknown> = { product_verified_at: nowIso }
    if (typeof s.image === 'string' && s.image) patch.image_url = s.image
    if (typeof s.price === 'number' && s.price > 0) patch.price_now_cents = Math.round(s.price * 100)
    if (typeof s.rating === 'number' && s.rating > 0) patch.rating = s.rating
    if (typeof s.monthlySales === 'number' && s.monthlySales >= 0) patch.monthly_sold = s.monthlySales
    if (typeof s.hasVideo === 'boolean') patch.video_count = s.hasVideo ? 1 : 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('cc_campaign_catalog').update(patch).eq('rep_asin', asin)
    if (!error) cached++
  }
  return NextResponse.json({ ok: true, cached })
}
