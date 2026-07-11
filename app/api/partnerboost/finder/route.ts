/**
 * POST /api/partnerboost/finder — the MVP Finder for PartnerBoost. Returns the
 * vetted, ranked, brand-diversified picks from the brands you've JOINED across
 * Walmart · Amazon · DTC.
 *
 * Two data paths:
 *   CACHE (instant) — if the user has synced (pb_finder_cache, migration 164),
 *     read straight from the cache with the rulebook filters applied in SQL.
 *   LIVE (fallback) — if nothing's synced yet, sweep the joined brands live
 *     (per-brand product calls in a concurrency pool). Slower; the UI nudges a
 *     sync for next time.
 *
 * PB exposes only price + brand commission (no rating/EPC/reviews), so the gate
 * is commission + price + category and the rank is estimated $/sale. A per-brand
 * diversity cap keeps one brand's near-duplicate listings from crowding the top.
 *
 * Body: { mode?, focus?, limit?, exclude?: string[] }
 * Returns: { ok, matches, source: 'cache'|'live', syncedAt?, joinedBrands?, brandsSwept?, scannedProducts, kept }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { sweepJoinedProducts, diversify } from '@/lib/partnerboost-sweep'
import {
  pbRules, brandPassesPb, passesPbGates, scorePb, type PbRuleMode, type ScoredPbMatch,
} from '@/lib/partnerboost-rules'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_PER_BRAND = 2 // at most 2 picks per brand in a single result set

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Match = Record<string, any>

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsFinders(tier)) return NextResponse.json({ ok: false, error: 'MVP x PartnerBoost requires a paid plan.' }, { status: 403 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })

    const body = await request.json().catch(() => ({})) as { mode?: string; focus?: string; limit?: number; exclude?: string[] }
    const mode: PbRuleMode = body.mode === 'wide' ? 'wide' : 'focus'
    const rules = pbRules(mode)
    const limit = [10, 20, 50].includes(Number(body.limit)) ? Number(body.limit) : 20
    const focus = (body.focus || '').trim().toLowerCase()
    const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map((k) => String(k)))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // ── CACHE path — if the user has synced, read from pb_finder_cache ─────────
    // Explicit user_id filter (defense-in-depth): pb_finder_cache is RLS-scoped
    // to auth.uid(), but a security-sensitive read must never rely on RLS alone.
    const { count: cacheCount } = await sb.from('pb_finder_cache').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    if ((cacheCount ?? 0) > 0) {
      let q = sb.from('pb_finder_cache')
        .select('product_key, name, price, commission_pct, per_sale, image_url, url, category, brand_name, brand_id, brand_mcid, network, sku, tracking_url, brand_tracking_url, synced_at')
        .eq('user_id', user.id)
        .eq('avoided', false)
        .gte('price', rules.minPrice).lte('price', rules.maxPrice)
        // Match brandPassesPb: percent brands by commission, flat-CPA brands by payout.
        .or(`commission_pct.gte.${rules.minCommissionPct},and(commission_pct.is.null,flat_payout.gte.${rules.minFlatPayout})`)
      if (focus) q = q.ilike('name', `%${focus}%`)
      const { data: rows } = await q.order('score', { ascending: false }).limit(600)
      const list: Match[] = (rows ?? []).map((r: Match) => ({
        key: r.product_key, name: r.name, priceNum: r.price,
        price: r.price != null ? String(r.price) : null,
        commissionPct: r.commission_pct, perSale: r.per_sale,
        image: r.image_url, url: r.url, category: r.category,
        brandName: r.brand_name, brandId: r.brand_id, brandMcid: r.brand_mcid, network: r.network, sku: r.sku,
        trackingUrl: r.tracking_url || '', brandTrackingUrl: r.brand_tracking_url || '',
      }))
      const matches = diversify(list as (Match & { key: string; brandName: string | null; network: string })[], { limit, maxPerBrand: MAX_PER_BRAND, exclude })
      const syncedAt = (rows && rows[0]?.synced_at) || null
      return NextResponse.json({
        ok: true, source: 'cache', syncedAt, matches, scannedProducts: cacheCount, kept: matches.length,
        ...(matches.length === 0 ? { note: 'No products in your synced catalog cleared the criteria. Try Wide, a different focus keyword, or re-sync.' } : {}),
      })
    }

    // ── LIVE path — nothing synced yet; sweep the joined brands now ───────────
    const { raw, joinedTotal, brandsSwept } = await sweepJoinedProducts(token, {
      focus, concurrency: 12, deadlineMs: 250_000,
      brandGate: (b) => brandPassesPb(b, rules),
    })
    const bestByKey = new Map<string, ScoredPbMatch>()
    for (const c of raw) {
      if (!c.key) continue
      if (focus && !`${c.name || ''} ${c.category || ''}`.toLowerCase().includes(focus)) continue
      if (!passesPbGates(c, rules)) continue
      const scored = scorePb(c)
      const prev = bestByKey.get(c.key)
      if (!prev || scored.score > prev.score) bestByKey.set(c.key, scored)
    }
    const sorted = Array.from(bestByKey.values()).sort((a, b) => b.score - a.score)
    const matches = diversify(sorted, { limit, maxPerBrand: MAX_PER_BRAND, exclude })

    return NextResponse.json({
      ok: true, source: 'live', joinedBrands: joinedTotal, brandsSwept, scannedProducts: raw.length, kept: matches.length,
      ...(matches.length === 0 ? { note: 'No products cleared the MVP criteria on this sweep. Try Wide or a different focus keyword.' } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'PartnerBoost request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
