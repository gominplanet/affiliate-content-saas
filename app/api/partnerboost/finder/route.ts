/**
 * POST /api/partnerboost/finder — the MVP Finder for PartnerBoost. Sweeps the
 * brands you've JOINED across every network (Walmart · Amazon · DTC), applies
 * MVP's proprietary rulebook (lib/partnerboost-rules.ts), and returns the vetted
 * picks ranked best-first.
 *
 * PartnerBoost gives thin signal — a product PRICE and a BRAND commission, no
 * rating/reviews/EPC/sales — so the gate is commission + price + category and
 * the rank is estimated $/sale. Its product feed is per-brand (no bulk
 * multi-brand call), so we sweep Joined brands highest-commission-first within a
 * wall-clock budget. "Scan again — more" pages deeper.
 *
 * Body: { mode?, focus?, limit?, exclude?: string[], network? }
 * Returns: { ok, matches, joinedBrands, brandsSwept, scannedProducts, kept }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import {
  listPartnerBoostBrands, listPartnerBoostProducts, listAmazonProducts,
  type PBBrandType, type PBProduct,
} from '@/services/partnerboost'
import {
  pbRules, parseCommissionPct, parseDollars, brandPassesPb, passesPbGates, scorePb,
  type PbCandidate, type PbRuleMode,
} from '@/lib/partnerboost-rules'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const NETWORKS: PBBrandType[] = ['Walmart', 'Amazon', 'DTC']
const MAX_BRAND_PAGES = 6         // per network, 500/page → up to ~3000 joined/network
const BRAND_LIMIT = 500
const PRODUCT_LIMIT = 30          // products pulled per brand
const CONCURRENCY = 12            // product calls are per-brand → run them in a pool so ALL brands get checked
const SWEEP_DEADLINE_MS = 250_000 // backstop under the 300s function ceiling

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier === 'trial') {
      return NextResponse.json({ ok: false, error: 'MVP x PartnerBoost requires a paid plan.' }, { status: 403 })
    }

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })
    }

    const body = await request.json().catch(() => ({})) as {
      mode?: string; focus?: string; limit?: number; exclude?: string[]; network?: string
    }
    const mode: PbRuleMode = body.mode === 'wide' ? 'wide' : 'focus'
    const rules = pbRules(mode)
    const limit = [10, 20, 50].includes(Number(body.limit)) ? Number(body.limit) : 20
    const focus = (body.focus || '').trim().toLowerCase()
    const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map((k) => String(k)))
    const nets = NETWORKS.includes(body.network as PBBrandType) ? [body.network as PBBrandType] : NETWORKS

    // ── 1. Joined brands across the networks, brand-gated on commission ───────
    type SweepBrand = {
      network: PBBrandType; mcid: string | null; brandId: string | null; merchantName: string
      categories: string; trackingUrl: string; commissionPct: number | null; flatPayout: number | null
    }
    let joinedTotal = 0
    const gatedBrands: SweepBrand[] = []
    for (const network of nets) {
      for (let page = 1; page <= MAX_BRAND_PAGES; page++) {
        let res
        try { res = await listPartnerBoostBrands(token, { brandType: network, relationship: 'Joined', page, limit: BRAND_LIMIT }) }
        catch { break /* skip a bad network, keep the others */ }
        for (const b of res.brands) {
          joinedTotal++
          const commissionPct = parseCommissionPct(b.commRate)
          const flatPayout = parseDollars(b.avgPayout) ?? parseDollars(b.commRate)
          if (!brandPassesPb({ commissionPct, flatPayout }, rules)) continue
          gatedBrands.push({
            network, mcid: b.mcid, brandId: b.brandId, merchantName: b.merchantName,
            categories: b.categories, trackingUrl: b.trackingUrl, commissionPct, flatPayout,
          })
        }
        if (page >= res.totalPage) break
      }
    }
    if (gatedBrands.length === 0) {
      return NextResponse.json({ ok: true, matches: [], joinedBrands: joinedTotal, brandsSwept: 0, scannedProducts: 0, kept: 0,
        note: joinedTotal === 0
          ? 'No Joined brands yet. Join brands in PartnerBoost, then scan.'
          : 'None of your Joined brands clear the commission bar. Try Wide.' })
    }

    // Best-commission brands first so the budget is spent where the money is.
    gatedBrands.sort((a, b) => (b.commissionPct ?? 0) - (a.commissionPct ?? 0) || (b.flatPayout ?? 0) - (a.flatPayout ?? 0))

    // ── 2. Product sweep — EVERY gated brand, in a concurrency pool ───────────
    // PartnerBoost's product feed is per-brand (no bulk multi-brand call), so
    // covering 1000+ joined brands means 1000+ calls. Running them CONCURRENCY
    // at a time (instead of one-by-one) is what makes checking them all fit in
    // the budget. Highest-commission brands go first so if the deadline does
    // bite, the money brands are already done.
    const raw: PbCandidate[] = []
    const t0 = Date.now()
    let brandsSwept = 0
    let cursor = 0
    const tok: string = token // capture the narrowed token for the nested closure
    async function sweepOne(b: SweepBrand) {
      let products: PBProduct[] = []
      try {
        const r = b.network === 'Amazon'
          ? await listAmazonProducts(tok, { brandId: b.brandId || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
          : await listPartnerBoostProducts(tok, { brandType: b.network, brandId: b.brandId || undefined, mcid: b.mcid || undefined, keywords: focus || undefined, limit: PRODUCT_LIMIT })
        products = r.products
      } catch { brandsSwept++; return /* skip a failed/rate-limited brand */ }
      for (const p of products) {
        raw.push({
          key: (p.sku && String(p.sku)) || p.url,
          name: p.name,
          priceNum: parseDollars(p.price),
          price: p.price,
          commissionPct: b.commissionPct,
          flatPayout: b.flatPayout,
          image: p.image,
          url: p.url,
          category: p.category,
          brandName: b.merchantName || p.merchantName || p.brand,
          brandCategories: b.categories,
          network: b.network,
          sku: p.sku,
          trackingUrl: p.trackingUrl || '',
          brandTrackingUrl: b.trackingUrl,
        })
      }
      brandsSwept++
    }
    // CONCURRENCY workers pull from a shared cursor until every brand is done
    // (or the wall-clock backstop trips).
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < gatedBrands.length && Date.now() - t0 <= SWEEP_DEADLINE_MS) {
        const b = gatedBrands[cursor++]
        await sweepOne(b)
      }
    }))

    // ── 3. Gate → dedupe (best per key) → focus → rank → top-N ────────────────
    const bestByKey = new Map<string, ReturnType<typeof scorePb>>()
    for (const c of raw) {
      if (!c.key || exclude.has(c.key)) continue
      if (focus && !`${c.name || ''} ${c.category || ''}`.toLowerCase().includes(focus)) continue
      if (!passesPbGates(c, rules)) continue
      const scored = scorePb(c)
      const prev = bestByKey.get(c.key)
      if (!prev || scored.score > prev.score) bestByKey.set(c.key, scored)
    }
    const matches = Array.from(bestByKey.values()).sort((a, b) => b.score - a.score).slice(0, limit)

    return NextResponse.json({
      ok: true,
      matches,
      joinedBrands: joinedTotal,
      brandsSwept,
      scannedProducts: raw.length,
      kept: matches.length,
      ...(matches.length === 0 ? { note: 'No products cleared the MVP criteria on this sweep. Try Wide or a different focus keyword.' } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'PartnerBoost request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
