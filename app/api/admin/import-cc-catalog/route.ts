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
      const { count, error } = await q
      // Return null (→ shown as "—") on any failure or a nullish count. NEVER
      // coerce to 0: a false 0 on the Live Catalog card reads as "the whole
      // shared catalog was wiped" and is needlessly alarming.
      if (error || count == null) return null
      return count
    } catch { return null }
  }
  // Whether staging has ANY rows — a cheap existence check (limit 1) that does
  // NOT time out like an exact COUNT over 800k rows. The UI uses THIS (not the
  // flaky count) to decide "is staging empty / can I merge", so a slow count
  // can never falsely disable Merge or show "Staging is empty".
  //   true  = has rows, false = genuinely empty, null = couldn't tell (treat as
  //   "maybe" → don't block; the merge endpoint has its own existence guard).
  const hasStagedCheck = async (): Promise<boolean | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).from('cc_campaign_catalog_import').select('campaign_id').limit(1)
      if (error) return null
      return (data?.length ?? 0) > 0
    } catch { return null }
  }
  const [staged, live, enriched, hasStaged] = await Promise.all([
    countOf('cc_campaign_catalog_import'),
    countOf('cc_campaign_catalog'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf('cc_campaign_catalog', (q: any) => q.not('product_verified_at', 'is', null)),
    hasStagedCheck(),
  ])
  return NextResponse.json({ ok: true, staged, live, enriched, hasStaged })
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

    // Best-effort EXACT count that never throws and returns null on failure. An
    // exact COUNT over a 700k–800k row table can hit the statement timeout and
    // come back null; callers must treat null as "unknown", NEVER as 0.
    const exactCount = async (table: string, mod?: (q: any) => any): Promise<number | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (admin as any).from(table).select('campaign_id', { count: 'exact', head: true })
        if (mod) q = mod(q)
        const { count, error } = await q
        return error || count == null ? null : count
      } catch { return null }
    }

    // Guard 1: refuse to merge an EMPTY staging table (that would purge the whole
    // live catalog). Use a CHEAP existence check (limit 1), not an exact count —
    // an exact count over a huge staging table can time out and return null,
    // which previously read as "empty" and falsely blocked a real 800k import.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sampleRows, error: sampleErr } = await (admin as any)
      .from('cc_campaign_catalog_import').select('campaign_id').limit(1)
    if (sampleErr) {
      return NextResponse.json({ error: toUserMessage(sampleErr, 'Could not read the staging table. Try again in a moment.') }, { status: 500 })
    }
    if (!sampleRows || sampleRows.length === 0) {
      return NextResponse.json({
        error: 'Staging table cc_campaign_catalog_import is empty. Load your CSV into it first, then run this.',
      }, { status: 400 })
    }

    // Guard 2: a merge PURGES every live row not in staging. If staging is far
    // smaller than the live catalog, this is almost certainly a PARTIAL upload —
    // refuse and make the admin confirm. Best-effort: only enforce this when BOTH
    // counts are known. If a count timed out (null), skip the prompt rather than
    // block a legitimate merge — Guard 1 already proved staging isn't empty, and
    // the merge itself is chunked + resumable.
    const [stagedCount, liveCount] = await Promise.all([
      exactCount('cc_campaign_catalog_import'),
      exactCount('cc_campaign_catalog'),
    ])
    if (!body.confirm && stagedCount != null && liveCount != null && liveCount > 0 && stagedCount < liveCount * 0.6) {
      return NextResponse.json({
        needsConfirm: true,
        staged: stagedCount,
        live: liveCount,
        wouldPurgeApprox: Math.max(0, liveCount - stagedCount),
        error: `Only ${stagedCount.toLocaleString()} campaigns are staged, but the live catalog has ${liveCount.toLocaleString()}. Merging now would remove roughly ${Math.max(0, liveCount - stagedCount).toLocaleString()} campaigns. If you haven't uploaded ALL your CSV files yet, upload the rest first.`,
      }, { status: 409 })
    }

    // Chunked, resumable merge (migration 202). Small batches so no single RPC
    // times out; loop only until a soft wall-clock deadline (well under this
    // function's maxDuration), then return done:false with how many rows remain
    // — the CLIENT auto-calls again to continue. The _merged marker means each
    // call resumes exactly where the last stopped. The purge runs on the final
    // call, once every staged row is merged.
    // Short per-call window so the client gets a fresh "N left" countdown every
    // ~40s (it auto-resumes until done), instead of one long silent 4-min call.
    const BATCH = 2000
    const deadline = Date.now() + 40_000
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

    // Are we done? Derive it from the STEP's own result, NOT a separate count:
    // the last step returning fewer than a full batch means no unmerged rows are
    // left. Relying on a COUNT here was dangerous — if that count timed out and
    // returned null, the old code treated it as 0 and ran the PURGE before every
    // row had merged, deleting rows that were about to be re-inserted.
    const drained = n < BATCH
    if (!drained) {
      // Still more to merge; the client auto-calls again. Report a best-effort
      // remaining for the countdown (null → the client just shows "Merging…").
      const remaining = await exactCount('cc_campaign_catalog_import', (q: any) => q.eq('_merged', false)) // eslint-disable-line @typescript-eslint/no-explicit-any
      return NextResponse.json({ ok: true, done: false, staged: stagedCount ?? undefined, upserted, remaining: remaining ?? null })
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
      staged: stagedCount ?? undefined,
      upserted,
      purged: Number(purgedData ?? 0),
    })
  } catch (err) {
    console.error('[import-cc-catalog]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Import failed. Please try again.') }, { status: 500 })
  }
}
