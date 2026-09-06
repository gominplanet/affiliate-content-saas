// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/scan-products   { asins?: string[] }
//
// Fill in the products a creator has joined campaigns for but never looked up.
//
// The Joined Campaigns page can now say which campaign is worth the work and let
// the creator pick which of its products to make something about. Both fall over
// on a product nothing knows anything about: a row with no picture and no price
// is hard to judge, and a picker offering six bare ASINs is not a choice, it is a
// guess with extra steps.
//
// Everything MVP needs is already reachable, it had simply never been asked for
// these particular products. Nothing scans an ASIN just because a campaign was
// joined for it, so a creator who accepted through a bulk action has a list of
// ids and nothing else.
//
// Two reads, both batched a hundred at a time and both cache-first, so a product
// another creator already looked up costs nothing:
//   the shared Keepa cache for the picture, the price, the rank and how many
//   sell a month, and the brand/title read for a name a person recognises.
//
// Bounded per call and reports what is left, because this spends a real budget
// and a creator with hundreds of joined campaigns should be able to fill in a
// page at a time rather than commit to all of it blind.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'
import { fetchKeepaBrandInfo } from '@/services/keepa'
import { mergeCampaignRows, isJoined } from '@/lib/campaign-rows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** One press fills in this many products. Keepa batches a hundred a request, so
 *  this is three requests of each kind, and a creator with hundreds of campaigns
 *  presses again rather than waiting on one enormous call. */
const PER_CALL = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const body = await request.json().catch(() => ({})) as { asins?: string[] }
    const asked = [...new Set((body.asins ?? [])
      .map(a => String(a || '').toUpperCase())
      .filter(a => /^[A-Z0-9]{10}$/.test(a)))]

    // No list given means "the products I have joined campaigns for", which is
    // the whole point of the button on the page.
    let candidates = asked
    if (!candidates.length) {
      const { data } = await sb.from('campaigns')
        .select('asin, accepted_at, amazon_joined_at, details_url')
        .eq('user_id', ownerId).limit(2000)
      const merged = mergeCampaignRows((data ?? []) as { asin: string }[])
      const ledger = new Set<string>()
      try {
        const { data: led } = await sb.from('cc_accepted_campaigns').select('asin').eq('user_id', ownerId).limit(2000)
        for (const r of (led ?? []) as { asin: string | null }[]) {
          const a = String(r.asin || '').toUpperCase()
          if (a) ledger.add(a)
        }
      } catch { /* the details_url fingerprint carries it alone */ }
      candidates = [...merged.entries()]
        .filter(([a, r]) => ledger.has(a) || (isJoined(r) && !!r.details_url))
        .map(([a]) => a)
    }
    if (!candidates.length) return NextResponse.json({ ok: true, scanned: 0, remaining: 0, filled: 0 })

    // Skip anything already known. A product another creator looked up is already
    // in the shared cache, and re-fetching it would spend the budget on an answer
    // MVP already has.
    const known = new Set<string>()
    const chunk = <T,>(xs: T[], n = 100) => {
      const out: T[][] = []
      for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
      return out
    }
    for (const part of chunk(candidates)) {
      try {
        const { data } = await admin.from('keepa_product_cache').select('asin').in('asin', part)
        for (const r of (data ?? []) as { asin: string }[]) known.add(String(r.asin).toUpperCase())
      } catch { /* nothing cached yet */ }
    }
    const unknown = candidates.filter(a => !known.has(a))
    const batch = unknown.slice(0, PER_CALL)
    if (!batch.length) {
      return NextResponse.json({ ok: true, scanned: 0, remaining: 0, filled: 0, alreadyKnown: candidates.length })
    }

    // The picture, price, rank and monthly sales. Writes the shared cache itself,
    // including a tombstone for a product Keepa knows nothing about, so a dud is
    // never re-fetched by the next creator.
    let filled = 0
    try {
      const basics = await fetchKeepaBasicsCached(admin, batch, { maxAgeDays: 30 })
      filled = basics.size
    } catch { /* the name read below may still succeed */ }

    // A name a person recognises. The catalog is where titles live and where the
    // product picker reads them from.
    try {
      const info = await fetchKeepaBrandInfo(batch)
      const rows = [...info.entries()]
        .filter(([, v]) => v.title || v.brand || v.imageUrl)
        .map(([asin, v]) => ({
          asin, title: v.title, brand: v.brand, image_url: v.imageUrl,
          last_seen_at: new Date().toISOString(),
        }))
      for (const part of chunk(rows)) {
        try { await admin.from('epc_catalog').upsert(part, { onConflict: 'asin' }) } catch { /* names are a bonus */ }
      }
    } catch { /* Keepa not configured, or a bad batch */ }

    return NextResponse.json({
      ok: true,
      scanned: batch.length,
      filled,
      remaining: Math.max(0, unknown.length - batch.length),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
