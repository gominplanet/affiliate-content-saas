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
export const maxDuration = 180

// Sweep the creator's FULL partnered set. Levanta pages brands + products via
// cursor and takes comma-joined brand_ids; we paginate every partnered brand,
// then pull products in URL-safe brand batches, breadth-first (one page per
// batch) so every brand is represented — bounded by a wall-clock budget so a
// huge account (800+ brands) can't run past the function ceiling.
const BRAND_PAGE = 100
const MAX_BRAND_PAGES = 40        // up to ~4000 partnered brands
const BRAND_CHUNK = 25            // brand_ids per /products call (URL-length safe)
const PRODUCT_PAGE = 500          // Levanta's per-page max
const MAX_PRODUCTS = 12000
const SWEEP_DEADLINE_MS = 90_000  // stop the product sweep before the 180s function ceiling

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

    // ── 1. Partnered brands (access:true) — paginate the FULL set ─────────────
    const partnered: { brandId: string; brandName: string }[] = []
    let bCursor: string | undefined
    for (let p = 0; p < MAX_BRAND_PAGES; p++) {
      const { brands, cursor } = await listLevantaBrands(token, { access: true, marketplace: 'all', limit: BRAND_PAGE, cursor: bCursor })
      for (const b of brands) if (b.access && b.brandId) partnered.push({ brandId: b.brandId, brandName: b.brandName || b.brandId })
      if (!cursor) break
      bCursor = cursor
    }
    if (partnered.length === 0) {
      return NextResponse.json({ ok: true, matches: [], totalBrands: 0, scannedBrands: 0, scannedProducts: 0, kept: 0,
        note: 'No partnered brands yet. Approve brands in the Levanta dashboard, then scan.' })
    }
    const brandName = new Map(partnered.map((b) => [b.brandId, b.brandName]))
    const allIds = partnered.map((b) => b.brandId)

    // ── 2. Product sweep — breadth-first across ALL partnered brands in
    //        URL-safe batches (one page each so every brand is represented),
    //        bounded by a wall-clock budget. "Scan again — more" pages deeper. ──
    const raw: LevantaCandidate[] = []
    const t0 = Date.now()
    let sweepErr: unknown = null
    let brandsSwept = 0
    for (let i = 0; i < allIds.length; i += BRAND_CHUNK) {
      if (raw.length >= MAX_PRODUCTS || Date.now() - t0 > SWEEP_DEADLINE_MS) break
      const chunk = allIds.slice(i, i + BRAND_CHUNK)
      try {
        const { products } = await listLevantaProducts(token, { brandIds: chunk.join(','), marketplace: 'all', limit: PRODUCT_PAGE })
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
        brandsSwept += chunk.length
      } catch (e) { sweepErr = e /* one bad batch shouldn't kill the whole sweep */ }
    }
    if (raw.length === 0 && sweepErr) throw sweepErr

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
    // Diversity cap — at most 2 picks per brand so one brand's near-duplicate
    // listings can't crowd the top of the results.
    const ranked = Array.from(bestByAsin.values()).sort((a, b) => b.score - a.score)
    const perBrand = new Map<string, number>()
    const matches: typeof ranked = []
    for (const m of ranked) {
      if (matches.length >= limit) break
      const bk = (m.brandName || m.marketplace || '').toLowerCase()
      const n = perBrand.get(bk) ?? 0
      if (n >= 2) continue
      perBrand.set(bk, n + 1)
      matches.push(m)
    }

    return NextResponse.json({
      ok: true,
      matches,
      totalBrands: partnered.length,
      scannedBrands: brandsSwept,
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
