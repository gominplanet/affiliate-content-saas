/**
 * POST /api/epc/enrich — on-demand Keepa backfill for the caller's EPC library.
 *
 * The scan can save thousands of rows in one pass, and the paced background cron
 * (enrich-epc-products) fills their images/sales-rank/monthly-sold over hours.
 * This is the "fill it now" path: the EPC panel calls it in a loop and it walks
 * the caller's own NEVER-enriched rows (enriched_at IS NULL) a bounded batch at a
 * time, returning { done, remaining } so the client can keep going and show
 * progress. A row leaves the set once enriched (even if Keepa had no image), so
 * the loop terminates. Session-authed + per-user (RLS), so it only ever touches
 * the caller's library. Migration 281 nulls enriched_at once for pre-fix blanks.
 *
 * Respects the shared Keepa token floor so it can't starve Deal Radar / AMZ
 * Research on the same operator key — it stops early and reports stopped:'low_tokens'.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, tierAllowsCampaigns } from '@/lib/tier'
import { fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'
import { fetchKeepaBasicsCached } from '@/lib/keepa-cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEpcPatch } from '@/lib/epc-enrich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Distinct ASINs per call. fetchKeepaBasics batches 100 ASINs per Keepa request,
// so 150 ≈ 2 requests, a few seconds — small enough to stay well under the
// function limit while the client loops for the rest.
const BATCH = 150
// Yield the shared pool to interactive Keepa use, same floor as the cron.
const MIN_TOKENS = (() => {
  const n = Number(process.env.EPC_ENRICH_MIN_TOKENS ?? process.env.CC_ENRICH_MIN_TOKENS)
  return Number.isFinite(n) && n >= 0 ? n : 500
})()

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (!tierAllowsCampaigns(normalizeTier(ig?.tier))) {
      return NextResponse.json({ error: 'The EPC library is available on paid plans.' }, { status: 403 })
    }
    if (!keepaConfigured()) return NextResponse.json({ ok: true, done: true, filled: 0, remaining: 0, note: 'keepa_unconfigured' })

    // How many of the caller's rows still need the Keepa deal signals (the
    // backlog). Gated on deal_enriched_at (migration 287): a brand-new column, so
    // rows enriched before the deal signals existed get one backfill pass, and a
    // row leaves the set once stamped (even if Keepa had no price) so this always
    // terminates.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remainingCount = async (): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any)
        .from('epc_products')
        .select('asin', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('deal_enriched_at', null)
      return count ?? 0
    }

    // Yield when the shared pool is low — report remaining so the client can stop
    // cleanly and tell the user to try again later.
    const tok = await fetchKeepaTokenStatus()
    if (tok.tokensLeft != null && tok.tokensLeft < MIN_TOKENS) {
      return NextResponse.json({ ok: true, done: false, stopped: 'low_tokens', filled: 0, remaining: await remainingCount(), tokensLeft: tok.tokensLeft })
    }

    // This batch: oldest-scanned rows still missing the deal signals.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any)
      .from('epc_products')
      .select('asin, image_url')
      .eq('user_id', user.id)
      // Gate on deal_enriched_at so the loop TERMINATES — every processed row is
      // stamped below (even when Keepa returns nothing), so it drops out instead
      // of being re-picked forever.
      .is('deal_enriched_at', null)
      .order('scanned_at', { ascending: true })
      .limit(BATCH)
    if (error) {
      console.error('[epc/enrich]', error.message)
      return NextResponse.json({ ok: true, done: true, filled: 0, remaining: 0, note: 'query_skipped' })
    }
    const batch = (rows ?? []) as { asin: string; image_url: string | null }[]
    if (!batch.length) return NextResponse.json({ ok: true, done: true, filled: 0, remaining: 0 })

    const distinct = [...new Set(batch.map((r) => (r.asin || '').toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
    // Cache-first (shared across all users) so a product another creator already
    // fetched doesn't re-spend Keepa tokens. Uses the admin client for the shared cache.
    const basics = await fetchKeepaBasicsCached(createAdminClient(), distinct)
    const at = new Date().toISOString()
    // Batch the writes (was one awaited UPDATE per row — up to 150 serial round
    // trips per call). Chunked Promise.all keeps the DB round trips to a small
    // constant while the per-row patches stay distinct.
    let filled = 0
    const CHUNK = 25
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK)
      await Promise.all(slice.map(async (r) => {
        const asin = (r.asin || '').toUpperCase()
        const b = basics.get(asin)
        const patch = buildEpcPatch(b, r.image_url, at)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase as any)
          .from('epc_products').update(patch).eq('user_id', user.id).eq('asin', asin)
        if (!upErr && patch.image_url) filled++
      }))
    }

    const remaining = await remainingCount()
    return NextResponse.json({ ok: true, done: remaining === 0, filled, processed: batch.length, remaining, tokensLeft: tok.tokensLeft })
  } catch (err) {
    console.error('[epc/enrich]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't fill images just now. Please try again." }, { status: 500 })
  }
}
