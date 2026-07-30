// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/enrich-visible  { asins: string[] }
//
// On-demand image enrichment for the campaigns CURRENTLY ON SCREEN. The Browse
// view posts the representative ASINs of the page it rendered; we fill the ones
// still missing an image and return them so the cards fill in place. Writes the
// shared catalog, so once a product is enriched every viewer benefits.
//
// TWO sources, in order:
//   1. Amazon Creators API (affiliate-native, has price) for image + price.
//   2. Keepa FALLBACK for any ASIN the Creators API couldn't resolve (variation
//      children, retired, non-buyable). Keepa has near-universal image coverage
//      AND gives us rating / recent sales / video count / price too — so these
//      cards fill in fully, not just the picture.
//
// Bounded + shared-cache: only rows without an image are fetched, capped per
// call, deduped — cost scales with distinct products actually viewed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsFinders, type Tier } from '@/lib/tier'
import { getItemsByAsin, creatorsApiConfigured } from '@/services/amazon-creators'
import { fetchKeepaProductCard, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_PER_CALL = 20 // ASINs per request (2 GetItems batches, ~2s at 1 TPS)
const KEEPA_FALLBACK_CAP = 10 // Keepa lookups per call for Creators-API misses

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) return NextResponse.json({ signals: {} })
  // Need at least one image source; otherwise clean no-op (SCOUT still fills).
  if (!creatorsApiConfigured() && !keepaConfigured()) return NextResponse.json({ signals: {} })

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

  const signals: Record<string, unknown> = {}
  const now = new Date().toISOString()

  // ── 1. Creators API (image + price) ──
  const items = creatorsApiConfigured() ? await getItemsByAsin(todo) : new Map()
  const stillMissing: string[] = []
  for (const asin of todo) {
    const it = items.get(asin)
    if (!it || !it.imageUrl) { stillMissing.push(asin); continue }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('cc_campaign_catalog').update({
      image_url: it.imageUrl,
      ...(it.priceCents != null ? { price_now_cents: it.priceCents } : {}),
      product_verified_at: now,
    }).eq('rep_asin', asin)
    signals[asin] = {
      imageUrl: it.imageUrl,
      priceNow: it.priceCents != null ? Math.round(it.priceCents) / 100 : null,
    }
  }

  // ── 2. Keepa fallback for what Creators couldn't image ──
  if (keepaConfigured() && stillMissing.length) {
    for (const asin of stillMissing.slice(0, KEEPA_FALLBACK_CAP)) {
      const card = await fetchKeepaProductCard(asin)
      if (!card.imageUrl) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('cc_campaign_catalog').update({
        image_url: card.imageUrl,
        ...(card.priceNowCents != null ? { price_now_cents: card.priceNowCents } : {}),
        ...(card.priceWasCents != null ? { price_was_cents: card.priceWasCents } : {}),
        ...(card.discountPct != null ? { discount_pct: card.discountPct } : {}),
        ...(card.rating != null ? { rating: card.rating } : {}),
        ...(card.reviewCount != null ? { review_count: card.reviewCount } : {}),
        ...(card.monthlySold != null ? { monthly_sold: card.monthlySold } : {}),
        ...(Number.isFinite(card.videoCount) ? { video_count: card.videoCount } : {}),
        product_verified_at: now,
      }).eq('rep_asin', asin)
      signals[asin] = {
        imageUrl: card.imageUrl,
        priceNow: card.priceNowCents != null ? Math.round(card.priceNowCents) / 100 : null,
        priceWas: card.priceWasCents != null ? Math.round(card.priceWasCents) / 100 : null,
        discountPct: card.discountPct ?? null,
        rating: card.rating ?? null,
        reviewCount: card.reviewCount ?? null,
        monthlySold: card.monthlySold ?? null,
        videoCount: Number.isFinite(card.videoCount) ? card.videoCount : null,
      }
    }
  }
  return NextResponse.json({ signals })
}
