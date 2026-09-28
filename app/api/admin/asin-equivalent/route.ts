// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/asin-equivalent?asin=B091G65HH6&domain=amazon.ca   (admin only)
//
// Read-only check of the barcode match the coverage drain runs on products
// blocked as "not sold" in a country: each step and its answer, so a cell that
// did not move can be explained without guessing. What the drain would pick up
// next, the Keepa balance it checks first, the barcodes Keepa has for the
// source ASIN, every listing in that store under them, and the one it would
// pick, then the brand-and-name search when the barcode finds nothing.
// Writes nothing. Spends up to about 13 Keepa tokens.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/markets'
import { pickEquivalent, pickByName, nameSearchTerm } from '@/lib/asin-equivalent'
import { MIN_KEEPA_TOKENS } from '@/lib/product-availability'
import { fetchKeepaIdentity, fetchKeepaByCodes, fetchKeepaSearch, fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const url = new URL(request.url)
  const asin = String(url.searchParams.get('asin') || '').trim().toUpperCase()
  const domain = String(url.searchParams.get('domain') || 'amazon.ca').trim().toLowerCase()
  const mkt = marketByDomain(domain)
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'Give ?asin= a 10 character ASIN.' }, { status: 400 })
  if (!mkt) return NextResponse.json({ error: `Unknown store ${domain}.` }, { status: 400 })

  // What the drain's own query sees, with the same filters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data: waiting, error: qErr } = await sb.from('storefront_coverage')
    .select('id,domain,asin,reason,updated_at').eq('state', 'blocked').eq('stock', 'not_listed')
    .like('reason', 'Amazon does not sell this product in %')
    .not('reason', 'like', '%barcode and name checked%')
    .not('asin', 'is', null)
    .order('priority', { ascending: false }).limit(30)

  const tokens = await fetchKeepaTokenStatus()
  const ids = keepaConfigured() ? await fetchKeepaIdentity([asin]) : new Map()
  const src = ids.get(asin) ?? null
  const sourceCodes: string[] | null = src ? src.codes : null
  const listings = mkt.keepa == null ? null
    : sourceCodes && sourceCodes.length ? await fetchKeepaByCodes(sourceCodes, mkt.keepa) : []
  const picked = listings && sourceCodes ? pickEquivalent(sourceCodes, listings, asin) : null
  // The fallback the drain runs when the barcode finds nothing.
  const term = src ? nameSearchTerm(src) : null
  const hits = !picked && term && mkt.keepa != null ? await fetchKeepaSearch(term, mkt.keepa) : null
  const byName = src && hits ? pickByName(src, hits, mkt.lang.startsWith('en')) : null

  return NextResponse.json({
    asin, store: domain,
    drainQueue: { error: qErr?.message ?? null, cells: (waiting ?? []).length, sample: (waiting ?? []).slice(0, 5) },
    keepa: {
      configured: keepaConfigured(),
      tokensLeft: tokens.tokensLeft,
      drainNeedsAtLeast: MIN_KEEPA_TOKENS,
      drainWouldSkip: tokens.tokensLeft != null && tokens.tokensLeft < MIN_KEEPA_TOKENS,
    },
    storeHasKeepa: mkt.keepa != null,
    sourceBarcodes: sourceCodes === null ? 'Keepa did not answer for this ASIN' : sourceCodes,
    listingsInStore: listings === null ? (mkt.keepa == null ? 'Keepa does not cover this store' : 'Keepa lookup failed') : listings,
    picked,
    source: src ? { brand: src.brand, model: src.model, title: src.title } : null,
    nameSearch: picked ? 'not needed: the barcode matched' : !term ? 'no brand to search by' : hits === null ? 'search did not run' : {
      term, results: hits.map((h: { asin: string; brand: string | null; model: string | null; title: string | null }) => ({ asin: h.asin, brand: h.brand, model: h.model, title: h.title })),
      picked: byName,
    },
  })
}
