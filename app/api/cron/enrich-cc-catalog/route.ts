// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/enrich-cc-catalog  (Vercel cron; Bearer CRON_SECRET)
//
// Fills the CC catalog's product signals (image / price / rating / recent sales
// / carousel-video count) so the Affiliate+ "Browse all" filters (500+ sold,
// 4★+, ≤N videos) have real data to match — instead of the on-demand,
// per-visible-card enrichment which only ever covers a sliver.
//
// PACED + SHARED-KEY-SAFE:
//   - NEW campaigns first: orders by product_verified_at ASC NULLS FIRST (the
//     migration-197 index), so each weekly re-import's fresh arrivals get
//     enriched before anything is re-checked. Survivors keep their enrichment
//     (the safe import preserves it), so we never re-pay for them.
//   - Only LIVE campaigns (ends_at >= today) — no tokens wasted on ended ones.
//   - Re-verifies rows only once they're STALE (> CC_ENRICH_STALE_DAYS old).
//   - Stops on a per-run cap, a wall-clock deadline, or a Keepa token floor
//     (so Deal Radar, which shares the operator key, is never starved).
//
// Budget: ~2 Keepa tokens/product. Default cap 150/run × the cron cadence sets
// the daily spend (every 30 min ⇒ ~15k tokens/day). Tune with CC_ENRICH_* env.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaProductCard, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Below this many Keepa tokens we stop, leaving headroom for Deal Radar.
const MIN_TOKENS_TO_CONTINUE = 60
const STALE_DAYS = () => {
  const n = Number(process.env.CC_ENRICH_STALE_DAYS)
  // Default 45 (was 30): re-verify each enriched product every 45 days instead
  // of monthly — ~33% less recurring token load, prices age up to 45d. Override
  // with CC_ENRICH_STALE_DAYS.
  return Number.isFinite(n) && n >= 1 ? n : 45
}
const MAX_PER_RUN = () => {
  const n = Number(process.env.CC_ENRICH_MAX_PER_RUN)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 150
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) return NextResponse.json({ ok: true, skipped: 'keepa_unconfigured' })

  const admin = createAdminClient()
  const cap = MAX_PER_RUN()
  const today = new Date().toISOString().slice(0, 10)
  const staleCutoff = new Date(Date.now() - STALE_DAYS() * 86_400_000).toISOString()
  const deadline = Date.now() + 200_000 // well under maxDuration

  // Candidates: live campaigns whose representative product is unverified or
  // stale, new-first. Fetch a few × cap since many campaigns share a rep_asin;
  // we dedupe to distinct products below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any)
    .from('cc_campaign_catalog')
    .select('rep_asin, product_verified_at')
    .gte('ends_at', today)
    .not('rep_asin', 'is', null)
    // Unverified, stale, OR priced with the old model (priced_v2 false) — the
    // last case lets the cron work through pre-Buy-Box rows at its paced rate.
    .or(`product_verified_at.is.null,product_verified_at.lt.${staleCutoff},priced_v2.eq.false`)
    .order('product_verified_at', { ascending: true, nullsFirst: true })
    .limit(cap * 4)
  if (error) {
    console.error('[enrich-cc-catalog]', error.message)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 200 })
  }

  const seen = new Set<string>()
  const todo: string[] = []
  for (const r of (rows ?? []) as Array<{ rep_asin: string | null }>) {
    const a = (r.rep_asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(a) || seen.has(a)) continue
    seen.add(a); todo.push(a)
    if (todo.length >= cap) break
  }
  if (!todo.length) return NextResponse.json({ ok: true, enriched: 0, note: 'nothing due' })

  let enriched = 0
  let tokensLeft: number | null = null
  let stoppedForTokens = false
  const nowIso = new Date().toISOString()

  for (const asin of todo) {
    if (Date.now() > deadline) break
    if (tokensLeft != null && tokensLeft < MIN_TOKENS_TO_CONTINUE) { stoppedForTokens = true; break }

    const card = await fetchKeepaProductCard(asin)
    if (card.tokensLeft != null) tokensLeft = card.tokensLeft

    // Even a card with no image is a verified check — stamp it so we don't keep
    // re-hitting a product Keepa has nothing for. Write whatever signals exist.
    const patch: Record<string, unknown> = { product_verified_at: nowIso, priced_v2: true }
    if (card.imageUrl) patch.image_url = card.imageUrl
    if (card.priceNowCents != null) patch.price_now_cents = card.priceNowCents
    if (card.priceWasCents != null) patch.price_was_cents = card.priceWasCents
    if (card.discountPct != null) patch.discount_pct = card.discountPct
    if (card.rating != null) patch.rating = card.rating
    if (card.reviewCount != null) patch.review_count = card.reviewCount
    if (card.monthlySold != null) patch.monthly_sold = card.monthlySold
    if (Number.isFinite(card.videoCount)) patch.video_count = card.videoCount
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (admin as any)
      .from('cc_campaign_catalog').update(patch).eq('rep_asin', asin)
    if (!upErr) enriched++
  }

  return NextResponse.json({ ok: true, enriched, candidates: todo.length, tokensLeft, stoppedForTokens })
}
