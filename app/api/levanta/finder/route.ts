/**
 * POST /api/levanta/finder — the MVP Finder for Levanta. Sweeps the caller's
 * PARTNERED brands, pulls their products in bulk, applies MVP's proprietary
 * Levanta rulebook (lib/levanta-rules.ts), and returns only the vetted picks,
 * ranked best-first. The Levanta answer to the Amazon "AMZ Product Finder": one
 * click instead of digging brand-by-brand.
 *
 * Everything runs server-side off the Levanta Creator API — no SCOUT, no Amazon
 * scrape — so it's fast and doesn't touch Amazon's throttle.
 *
 * Body: { mode?: 'focus'|'wide', focus?: string, limit?: 10|20|50, exclude?: string[] }
 * Returns: { ok, matches, scannedBrands, scannedProducts, kept }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listLevantaBrands, listLevantaProducts } from '@/services/levanta'
import { getExternalKey } from '@/lib/external-keys'
import {
  levantaRules, passesLevantaGates, scoreLevanta,
  type LevantaCandidate, type LevantaRuleMode,
} from '@/lib/levanta-rules'
import type { Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Bound the sweep so a big account can't fan out forever. Levanta accepts
// comma-joined brand_ids and up to 500 products/page; a few pages across the
// partnered set is plenty to surface the winners.
const MAX_BRANDS = 60
const PRODUCT_PAGE = 200
const MAX_PAGES = 5
const MAX_PRODUCTS = 1000

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (tier === 'trial') {
      return NextResponse.json({ ok: false, error: 'MVP x Levanta requires a paid plan.' }, { status: 403 })
    }

    const token = await getExternalKey(supabase, user.id, 'levanta')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Levanta API key in External Integrations.' })
    }

    const body = await request.json().catch(() => ({})) as {
      mode?: string; focus?: string; limit?: number; exclude?: string[]
    }
    const mode: LevantaRuleMode = body.mode === 'wide' ? 'wide' : 'focus'
    const rules = levantaRules(mode)
    const limit = [10, 20, 50].includes(Number(body.limit)) ? Number(body.limit) : 20
    const focus = (body.focus || '').trim().toLowerCase()
    const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map((a) => String(a).toUpperCase()))

    // ── 1. Partnered brands (access:true) — the sweep universe ────────────────
    const { brands } = await listLevantaBrands(token, { access: true, marketplace: 'all', limit: 100 })
    const partnered = brands.filter((b) => b.access && b.brandId)
    if (partnered.length === 0) {
      return NextResponse.json({ ok: true, matches: [], scannedBrands: 0, scannedProducts: 0, kept: 0,
        note: 'No partnered brands yet. Approve brands in the Levanta dashboard, then scan.' })
    }
    const brandName = new Map(partnered.map((b) => [b.brandId, b.brandName || b.brandId]))
    const brandIds = partnered.slice(0, MAX_BRANDS).map((b) => b.brandId).join(',')

    // ── 2. Bulk product pull across the partnered set (bounded paging) ────────
    const raw: LevantaCandidate[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES && raw.length < MAX_PRODUCTS; page++) {
      const { products, cursor: next } = await listLevantaProducts(token, {
        brandIds, cursor, marketplace: 'all', limit: PRODUCT_PAGE,
      })
      for (const p of products) {
        raw.push({
          asin: p.asin,
          title: p.title,
          price: p.price,
          commission: p.commission,
          rating: p.rating != null ? Number(p.rating) : null,
          ratingsTotal: p.ratingsTotal,
          platformEpc: p.platformEpc,
          category: p.category,
          inStock: p.inStock,
          image: p.image,
          brandId: p.brandId,
          brandName: (p.brandId && brandName.get(p.brandId)) || null,
          marketplace: p.marketplace || 'amazon.com',
        })
      }
      if (!next) break
      cursor = next
    }

    // ── 3. Gate → dedupe (keep best per ASIN) → focus filter → rank → top-N ───
    const bestByAsin = new Map<string, ReturnType<typeof scoreLevanta>>()
    for (const c of raw) {
      // Amazon ASINs are exactly 10 alphanumerics. Levanta occasionally returns
      // a non-Amazon product whose primary id is an EAN/barcode (14 digits) —
      // those have no /dp page, so Buy/Generate/Save would all break. Drop them.
      if (!/^[A-Z0-9]{10}$/.test(c.asin) || exclude.has(c.asin)) continue
      if (focus && !`${c.title || ''} ${c.category || ''}`.toLowerCase().includes(focus)) continue
      if (!passesLevantaGates(c, rules)) continue
      const scored = scoreLevanta(c)
      const prev = bestByAsin.get(c.asin)
      if (!prev || scored.score > prev.score) bestByAsin.set(c.asin, scored)
    }
    const matches = Array.from(bestByAsin.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return NextResponse.json({
      ok: true,
      matches,
      scannedBrands: Math.min(partnered.length, MAX_BRANDS),
      scannedProducts: raw.length,
      kept: matches.length,
      ...(matches.length === 0 ? { note: 'No products cleared the MVP criteria on this sweep. Try Wide, a different focus keyword, or partner with more brands in Levanta.' } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Levanta request timed out.'
      : e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
