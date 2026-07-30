// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/import-cc-catalog   (admin only)
//
// Merges the weekly CC campaign CSV into the live catalog WITHOUT wiping the
// enriched product signals. Flow:
//   1. Load your weekly CSV into the staging table `cc_campaign_catalog_import`
//      (Supabase dashboard import or SQL COPY — replace it freely).
//   2. POST here. This runs merge_cc_catalog_import() (migration 200): upserts
//      the campaign-economics columns, leaves image/sales/rating/video
//      enrichment untouched on surviving rows, and purges campaigns that fell
//      out of the latest CSV.
//
// Returns { upserted, purged } so you can confirm the import landed.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET → row counts for the admin page (live catalog + what's staged, and how
// much of the live catalog is enriched so far).
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const admin = createAdminClient()
  const countOf = async (table: string, mod?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (admin as any).from(table).select('campaign_id', { count: 'exact', head: true })
      if (mod) q = mod(q)
      const { count } = await q
      return count ?? 0
    } catch { return null }
  }
  const [staged, live, enriched] = await Promise.all([
    countOf('cc_campaign_catalog_import'),
    countOf('cc_campaign_catalog'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf('cc_campaign_catalog', (q: any) => q.not('product_verified_at', 'is', null)),
  ])
  return NextResponse.json({ ok: true, staged, live, enriched })
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { confirm?: boolean }
    const admin = createAdminClient()
    // Guard 1: refuse to merge an empty staging table (that would purge the whole
    // live catalog). A real weekly import always has tens of thousands of rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from('cc_campaign_catalog_import').select('campaign_id', { count: 'exact', head: true })
    if (!count || count < 1) {
      return NextResponse.json({
        error: 'Staging table cc_campaign_catalog_import is empty. Load your CSV into it first, then run this.',
      }, { status: 400 })
    }

    // Guard 2: a merge PURGES every live row not in staging. If staging is far
    // smaller than the live catalog, this is almost certainly a PARTIAL upload
    // (only some of the weekly files loaded) — refuse and make the admin confirm,
    // rather than silently deleting the rest of the catalog.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: liveCount } = await (admin as any)
      .from('cc_campaign_catalog').select('campaign_id', { count: 'exact', head: true })
    const live = liveCount ?? 0
    if (!body.confirm && live > 0 && count < live * 0.6) {
      return NextResponse.json({
        needsConfirm: true,
        staged: count,
        live,
        wouldPurgeApprox: Math.max(0, live - count),
        error: `Only ${count.toLocaleString()} campaigns are staged, but the live catalog has ${live.toLocaleString()}. Merging now would remove roughly ${Math.max(0, live - count).toLocaleString()} campaigns. If you haven't uploaded ALL your CSV files yet, upload the rest first.`,
      }, { status: 409 })
    }

    // Chunked, resumable merge (migration 202). Small batches so no single RPC
    // times out; loop only until a soft wall-clock deadline (well under this
    // function's maxDuration), then return done:false with how many rows remain
    // — the CLIENT auto-calls again to continue. The _merged marker means each
    // call resumes exactly where the last stopped. The purge runs on the final
    // call, once every staged row is merged.
    const BATCH = 2000
    const deadline = Date.now() + 240_000
    let upserted = 0
    let n = BATCH
    while (n >= BATCH && Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('merge_cc_catalog_step', { p_limit: BATCH })
      if (error) {
        console.error('[import-cc-catalog step]', error.message)
        // Most common cause: migration 202 (the step/purge functions) not applied.
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        return NextResponse.json({
          error: missingFn
            ? 'The merge database functions are missing — run migration 202 in Supabase, then click Merge again.'
            : toUserMessage(error, 'Merge stopped partway. Click Merge again to resume where it left off.'),
          detail: error.message?.slice(0, 200), upsertedSoFar: upserted,
        }, { status: 500 })
      }
      n = Number(data ?? 0)
      upserted += n
    }

    // More staged rows still to merge? Tell the client to call us again.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: remaining } = await (admin as any)
      .from('cc_campaign_catalog_import').select('campaign_id', { count: 'exact', head: true }).eq('_merged', false)
    if ((remaining ?? 0) > 0) {
      return NextResponse.json({ ok: true, done: false, staged: count, upserted, remaining: remaining ?? 0 })
    }

    // Everything merged → purge fall-outs and finish.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: purgedData, error: purgeErr } = await (admin as any).rpc('merge_cc_catalog_purge')
    if (purgeErr) {
      console.error('[import-cc-catalog purge]', purgeErr.message)
      return NextResponse.json({ error: toUserMessage(purgeErr, 'Upsert done but the purge failed. Click Merge again.'), upserted }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      done: true,
      staged: count,
      upserted,
      purged: Number(purgedData ?? 0),
    })
  } catch (err) {
    console.error('[import-cc-catalog]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Import failed. Please try again.') }, { status: 500 })
  }
}
