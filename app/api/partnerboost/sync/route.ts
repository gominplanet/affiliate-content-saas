/**
 * PartnerBoost catalog sync — pulls the user's full joined-brand product set
 * into pb_finder_cache (migration 164) so the Finder can read it back instantly.
 *   POST → run a sweep of every joined brand, upsert all products, purge stale.
 *   GET  → { count, syncedAt } so the UI can show "synced N products, 2h ago".
 *
 * Long-running (per-brand calls across 1000+ brands); maxDuration 300 + a 260s
 * internal budget. Re-running tops up whatever the previous run didn't reach.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { sweepJoinedProducts } from '@/lib/partnerboost-sweep'
import { scorePb, isAvoidedPb, PB_RULES } from '@/lib/partnerboost-rules'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count } = await sb.from('pb_finder_cache').select('id', { count: 'exact', head: true })
  const { data: latest } = await sb.from('pb_finder_cache')
    .select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle()
  return NextResponse.json({ ok: true, count: count ?? 0, syncedAt: latest?.synced_at ?? null })
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier === 'trial') return NextResponse.json({ ok: false, error: 'MVP x PartnerBoost requires a paid plan.' }, { status: 403 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key first.' })

    // Sweep everything worth caching — drop only zero-commission brands so the
    // cache stays useful across Focus/Wide/keyword without re-hitting the API.
    const { raw, joinedTotal, brandsSwept, timedOut } = await sweepJoinedProducts(token, {
      concurrency: 12,
      deadlineMs: 260_000,
      brandGate: (b) => (b.commissionPct ?? 0) >= 1 || (b.flatPayout ?? 0) >= 1,
    })

    // Dedupe by product key (best score wins), precompute score/per_sale/avoided.
    const runStart = new Date().toISOString()
    const bestByKey = new Map<string, ReturnType<typeof scorePb>>()
    for (const c of raw) {
      if (!c.key) continue
      const scored = scorePb(c)
      const prev = bestByKey.get(c.key)
      if (!prev || scored.score > prev.score) bestByKey.set(c.key, scored)
    }
    const rows = Array.from(bestByKey.values()).map((m) => ({
      user_id: user.id,
      product_key: String(m.key).slice(0, 1000),
      name: m.name ? String(m.name).slice(0, 400) : null,
      price: m.priceNum,
      commission_pct: m.commissionPct,
      flat_payout: m.flatPayout,
      per_sale: m.perSale,
      score: m.score,
      avoided: isAvoidedPb(m, PB_RULES),
      image_url: m.image ? String(m.image).slice(0, 1000) : null,
      url: m.url ? String(m.url).slice(0, 1000) : null,
      category: m.category ? String(m.category).slice(0, 200) : null,
      brand_name: m.brandName ? String(m.brandName).slice(0, 200) : null,
      network: m.network,
      sku: m.sku ? String(m.sku).slice(0, 120) : null,
      tracking_url: m.trackingUrl ? String(m.trackingUrl).slice(0, 1000) : null,
      brand_tracking_url: m.brandTrackingUrl ? String(m.brandTrackingUrl).slice(0, 1000) : null,
      synced_at: runStart,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('pb_finder_cache').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,product_key' })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    // Purge products not refreshed this run (brands the user left / went stale).
    await sb.from('pb_finder_cache').delete().eq('user_id', user.id).lt('synced_at', runStart)

    return NextResponse.json({
      ok: true, joinedBrands: joinedTotal, brandsSwept, products: rows.length, timedOut, syncedAt: runStart,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
