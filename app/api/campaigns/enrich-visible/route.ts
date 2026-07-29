// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/enrich-visible  { asins: string[] }
//
// On-demand image enrichment for the campaigns CURRENTLY ON SCREEN, via the
// Amazon Creators API (the affiliate-native, operator-key source — NOT Keepa).
// The Browse view posts the representative ASINs of the page it rendered; we
// fetch images/title/price for the ones still missing an image and return them
// so the cards fill in place. Writes the shared catalog, so once a product is
// enriched every viewer benefits.
//
// Bounded + shared-cache: only rows without an image are fetched, capped per
// call, deduped — so cost scales with distinct products actually viewed. If the
// Creators API isn't configured, it's a clean no-op (SCOUT still fills scanned
// products), so nothing breaks.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsFinders, type Tier } from '@/lib/tier'
import { getItemsByAsin, creatorsApiConfigured } from '@/services/amazon-creators'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PER_CALL = 20 // ASINs per request (2 GetItems batches, ~2s at 1 TPS)

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) return NextResponse.json({ signals: {} })
  if (!creatorsApiConfigured()) return NextResponse.json({ signals: {} })

  const body = await request.json().catch(() => ({})) as { asins?: string[] }
  const asins = [...new Set((body.asins ?? [])
    .map(a => String(a || '').toUpperCase())
    .filter(a => /^[A-Z0-9]{10}$/.test(a)))].slice(0, 60)
  if (!asins.length) return NextResponse.json({ signals: {} })

  const admin = createAdminClient()
  // Only rows that still have no image — never re-spend on already-filled ones
  // (the cron/another viewer/SCOUT may have covered them).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from('cc_campaign_catalog')
    .select('rep_asin')
    .in('rep_asin', asins)
    .is('image_url', null)
    .limit(500)
  const todo = [...new Set(((rows ?? []) as Array<{ rep_asin: string | null }>)
    .map(r => (r.rep_asin || '').toUpperCase()).filter(Boolean))].slice(0, MAX_PER_CALL)
  if (!todo.length) return NextResponse.json({ signals: {} })

  const items = await getItemsByAsin(todo)
  const signals: Record<string, unknown> = {}
  for (const asin of todo) {
    const it = items.get(asin)
    if (!it || !it.imageUrl) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('cc_campaign_catalog').update({
      image_url: it.imageUrl,
      ...(it.priceCents != null ? { price_now_cents: it.priceCents } : {}),
      product_verified_at: new Date().toISOString(),
    }).eq('rep_asin', asin)
    signals[asin] = {
      imageUrl: it.imageUrl,
      priceNow: it.priceCents != null ? Math.round(it.priceCents) / 100 : null,
    }
  }
  return NextResponse.json({ signals })
}
