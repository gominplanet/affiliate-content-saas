// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/enrich-epc-products  (Vercel cron; Bearer CRON_SECRET)
//
// Fills the per-user EPC library's Keepa signals (image / sales rank / monthly
// sold) in the background. The EPC scan can save thousands of rows in one pass
// (Sponsored Products has no export, so SCOUT deep-scrolls the grid), while the
// on-demand enrichment at ingest only touches ~100 per scan so the scan itself
// stays fast. This cron works through the rest at a paced, token-safe rate — the
// same shape as enrich-cc-catalog.
//
// PACED + SHARED-KEY-SAFE:
//   - Only rows still MISSING an image or never enriched (backlog shrinks to
//     nothing once every product Keepa has data for is filled).
//   - Oldest scans first, so a big fresh scan's rows fill in order.
//   - One /product call covers up to 100 ASINs (fetchKeepaBasics), and an ASIN
//     shared across users is fetched once, then written to every owner's row.
//   - Stops on a per-run distinct-ASIN cap, a wall-clock deadline, or the shared
//     Keepa token floor — so Deal Radar / AMZ Research on the same key are never
//     starved.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKeepaBasics, fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Yield the shared pool to interactive Keepa calls: skip the run while tokens are
// below this floor. Same default + override convention as enrich-cc-catalog.
const MIN_TOKENS_TO_CONTINUE = (() => {
  const n = Number(process.env.EPC_ENRICH_MIN_TOKENS ?? process.env.CC_ENRICH_MIN_TOKENS)
  return Number.isFinite(n) && n >= 0 ? n : 500
})()
// Distinct ASINs fetched per run (~1 token each). 200 × a 30-min cadence clears a
// few-thousand-row library in well under a day without pinning the pool.
const MAX_PER_RUN = () => {
  const n = Number(process.env.EPC_ENRICH_MAX_PER_RUN)
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 200
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!keepaConfigured()) return NextResponse.json({ ok: true, skipped: 'keepa_unconfigured' })

  // Yield to interactive use when the shared pool is low.
  const tok = await fetchKeepaTokenStatus()
  if (tok.tokensLeft != null && tok.tokensLeft < MIN_TOKENS_TO_CONTINUE) {
    return NextResponse.json({ ok: true, skipped: 'low_tokens', tokensLeft: tok.tokensLeft })
  }

  const admin = createAdminClient()
  const cap = MAX_PER_RUN()
  const deadline = Date.now() + 200_000 // well under maxDuration

  // Backlog: rows never enriched OR still missing an image. Over-fetch (× 6) since
  // one ASIN can belong to several users; we dedupe to distinct ASINs below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any)
    .from('epc_products')
    .select('user_id, asin, image_url')
    .or('enriched_at.is.null,image_url.is.null')
    .order('scanned_at', { ascending: true })
    .limit(cap * 6)
  if (error) {
    // Missing table/columns (migrations 278/279 not applied) → nothing to do, not a failure.
    console.error('[enrich-epc-products]', error.message)
    return NextResponse.json({ ok: true, enriched: 0, note: 'query_skipped' })
  }

  type Row = { user_id: string; asin: string; image_url: string | null }
  const candidates = (rows ?? []) as Row[]
  // Distinct ASINs up to the per-run cap, and the rows to write once we have data.
  const distinct: string[] = []
  const seen = new Set<string>()
  for (const r of candidates) {
    const a = (r.asin || '').toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(a) || seen.has(a)) continue
    seen.add(a); distinct.push(a)
    if (distinct.length >= cap) break
  }
  if (!distinct.length) return NextResponse.json({ ok: true, enriched: 0, note: 'nothing due' })

  const wanted = new Set(distinct)
  const toWrite = candidates.filter((r) => wanted.has((r.asin || '').toUpperCase()))

  const basics = await fetchKeepaBasics(distinct)
  const at = new Date().toISOString()
  let enriched = 0
  for (const r of toWrite) {
    if (Date.now() > deadline) break
    const asin = (r.asin || '').toUpperCase()
    const b = basics.get(asin)
    const patch: Record<string, unknown> = { enriched_at: at }
    if (b) {
      if (b.monthlySold != null) patch.monthly_sold = b.monthlySold
      if (b.salesRank != null) patch.sales_rank = b.salesRank
      if (b.salesRankCategory) patch.sales_rank_category = b.salesRankCategory
      // Only fill the image if the scrape didn't already get one for this row.
      if (!r.image_url && b.imageUrl) patch.image_url = b.imageUrl
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (admin as any)
      .from('epc_products').update(patch).eq('user_id', r.user_id).eq('asin', asin)
    if (!upErr) enriched++
  }

  return NextResponse.json({ ok: true, enriched, distinctAsins: distinct.length, rows: toWrite.length, tokensLeft: tok.tokensLeft })
}
