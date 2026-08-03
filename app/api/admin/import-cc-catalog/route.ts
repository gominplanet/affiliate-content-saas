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
import { fetchKeepaTokenStatus } from '@/services/keepa'

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
      // ESTIMATED count (query-planner reltuples), NOT exact: an exact COUNT over
      // the ~240k-row catalog scans every row and hits Postgres's statement
      // timeout, returning null → the card shows a bare "—" even though the
      // catalog is full. Estimated is instant and plenty accurate for "is it in
      // the tens of thousands" — PostgREST still returns exact for small tables.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (admin as any).from(table).select('campaign_id', { count: 'estimated', head: true })
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
  const [staged, live, enriched, hasStaged, keepa] = await Promise.all([
    countOf('cc_campaign_catalog_import'),
    countOf('cc_campaign_catalog'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countOf('cc_campaign_catalog', (q: any) => q.not('product_verified_at', 'is', null)),
    hasStagedCheck(),
    // Live Keepa token balance — the shared budget enrichment / Deal Radar /
    // the Product Finder all draw from. /token doesn't cost product tokens.
    fetchKeepaTokenStatus(),
  ])
  return NextResponse.json({ ok: true, staged, live, enriched, hasStaged, keepa })
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

    // Guard 2 (below) uses ESTIMATED (reltuples) counts. They're instant, never
    // time out, and cost effectively zero Disk IO — unlike an exact COUNT over
    // ~850k bloated rows, which is a full sequential scan that stacked up across
    // auto-resumes and exhausted the Disk IO budget. Estimated is plenty accurate
    // for the 0.85 partial-upload ratio check.
    const estCount = async (table: string): Promise<number | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error } = await (admin as any).from(table).select('campaign_id', { count: 'estimated', head: true })
        return error || count == null ? null : Number(count)
      } catch { return null }
    }
    // Partial-upload guard — runs ONLY on the first (unconfirmed) call, and uses
    // ESTIMATED (reltuples) counts, never an exact COUNT(*). Both details matter:
    //   • Gated on !body.confirm: once the client has confirmed (it sets
    //     confirm=true after the first successful call), every auto-resume skips
    //     this block. The guard is a one-time partial-upload check, not per-chunk.
    //   • Estimated, not exact: an exact COUNT over ~850k bloated rows is a full
    //     sequential scan — 60s+ and heavy Disk IO. The FIRST call only sets
    //     confirm=true AFTER it succeeds, so an exact-count guard that timed out
    //     would fail the call, the client would retry with confirm STILL false,
    //     and those full-scan counts would STACK every ~40s until the Disk IO
    //     budget was exhausted and the whole merge crawled (a 57k-row purge took
    //     45+ min). Estimated is instant, zero-IO, and plenty accurate for a 0.85
    //     ratio sanity check. Only fires when BOTH estimates are known; an unknown
    //     estimate never blocks (Guard 1 already proved staging is non-empty, and
    //     the merge is chunked + resumable).
    let stagedCount: number | null = null
    let liveCount: number | null = null
    if (!body.confirm) {
      const [stagedEst, liveEst] = await Promise.all([
        estCount('cc_campaign_catalog_import'),
        estCount('cc_campaign_catalog'),
      ])
      stagedCount = stagedEst
      liveCount = liveEst
      if (stagedCount != null && liveCount != null && liveCount > 0 && stagedCount < liveCount * 0.85) {
        return NextResponse.json({
          needsConfirm: true,
          staged: stagedCount,
          live: liveCount,
          wouldPurgeApprox: Math.max(0, liveCount - stagedCount),
          error: `Only ~${stagedCount.toLocaleString()} campaigns are staged, but the live catalog has ~${liveCount.toLocaleString()}. Merging now would remove roughly ${Math.max(0, liveCount - stagedCount).toLocaleString()} campaigns — including still-live ones if this isn't your complete CSV. Upload ALL your CSV files first, then merge. Only confirm if you're sure staging holds every current campaign.`,
        }, { status: 409 })
      }
    }

    // Chunked, resumable merge (migration 202). Small batches so no single RPC
    // times out; loop only until a soft wall-clock deadline (well under this
    // function's maxDuration), then return done:false with how many rows remain
    // — the CLIENT auto-calls again to continue. The _merged marker means each
    // call resumes exactly where the last stopped. The purge runs on the final
    // call, once every staged row is merged.
    // Short per-call window so the client gets a fresh "N left" countdown every
    // ~40s (it auto-resumes until done), instead of one long silent 4-min call.
    //
    // Each merged row does TWO GIN index inserts (the STORED search_vec tsvector
    // + the asins array), and the step marks _merged=true in the SAME statement
    // as the insert — so a statement that hits the DB statement timeout rolls the
    // whole batch back and ZERO rows advance (what "same error every time" looks
    // like). The durable fix is NOT a tiny batch — it's migration 215, which
    // raises the service_role statement_timeout to 180s so a batch can finish
    // even while waiting out a lock held by the enrichment cron. With that
    // headroom we run larger batches for speed; the loop still commits each batch
    // (separate RPC calls) and the client auto-resumes until done.
    // Pause the enrichment cron while this merge runs so it isn't competing for
    // row locks (migration 216). Refreshed on every resume call; the cron ignores
    // a stale flag, so an abandoned import can't disable enrichment forever. Best-
    // effort — a missing system_flags table (pre-216) must not block the merge.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('system_flags').upsert(
        { key: 'cc_import_active', active: true, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
    } catch { /* pre-216 DB — proceed without the pause flag */ }

    const BATCH = 500
    // Purge is an anti-join (find catalog rows not in staging) — on a bloated
    // catalog it reads a lot of pages to find each victim, so a big batch can run
    // past the ~60s Supabase HTTP window and get orphaned. Keep it small so each
    // purge_step finishes inside the window; the client auto-resumes.
    const PURGE_BATCH = 400
    const deadline = Date.now() + 40_000
    let upserted = 0
    let n = BATCH
    let transientStop = false
    while (n >= BATCH && Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('merge_cc_catalog_step', { p_limit: BATCH })
      if (error) {
        // Migration 202 (the step/purge functions) not applied is the one NON-
        // resumable cause — surface it so the admin runs the migration.
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        if (missingFn) {
          return NextResponse.json({
            error: 'The merge database functions are missing — run migration 202 in Supabase, then click Merge again.',
            detail: error.message?.slice(0, 200), upsertedSoFar: upserted,
          }, { status: 500 })
        }
        // Anything else (statement/lock/HTTP timeout on a chunk) is RESUMABLE:
        // the marked-merged rows committed per RPC, so the next call picks up
        // where this left off. Don't fail the whole import — stop this call and
        // let the not-drained return below tell the client to auto-resume.
        console.error('[import-cc-catalog step transient]', error.message)
        transientStop = true
        break
      }
      n = Number(data ?? 0)
      upserted += n
    }

    // Are we done? Derive it from the STEP's own result, NOT a separate count:
    // the last step returning fewer than a full batch means no unmerged rows are
    // left. Relying on a COUNT here was dangerous — if that count timed out and
    // returned null, the old code treated it as 0 and ran the PURGE before every
    // row had merged, deleting rows that were about to be re-inserted.
    const drained = !transientStop && n < BATCH
    if (!drained) {
      // Still more to merge; the client auto-calls again. We deliberately do NOT
      // run a remaining-count here: an exact COUNT over the ~800k staging table
      // (filtered on _merged=false) is a full sequential scan that would run on
      // every ~40s resume and was a top Disk-IO hog. The client shows "Merging…"
      // when remaining is null, which is fine — correct, fast, and IO-cheap beats
      // a live countdown.
      return NextResponse.json({ ok: true, done: false, staged: stagedCount ?? undefined, upserted, remaining: null })
    }

    // Everything merged → purge fall-outs in CHUNKS (a single anti-join DELETE
    // over ~800k rows can time out). Loop bounded batches until the deadline;
    // if there's still more to delete, return done:false so the client resumes
    // (the upsert is drained, so the next call goes straight back to purging).
    let purged = 0
    let pn = PURGE_BATCH
    let purgeTransient = false
    while (Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('merge_cc_catalog_purge_step', { p_limit: PURGE_BATCH })
      if (error) {
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        if (missingFn) {
          return NextResponse.json({
            error: 'The chunked-purge function is missing — run migration 213 in Supabase, then click Merge again.',
            detail: error.message?.slice(0, 200), upserted, purgedSoFar: purged,
          }, { status: 500 })
        }
        // Resumable (timeout/lock on a purge chunk) — stop this call and let the
        // client auto-resume; the next call keeps purging.
        console.error('[import-cc-catalog purge transient]', error.message)
        purgeTransient = true
        break
      }
      pn = Number(data ?? 0)
      purged += pn
      if (pn < PURGE_BATCH) break // a short batch means no fall-outs remain
    }
    if (purgeTransient || pn >= PURGE_BATCH) {
      // More to purge (or a chunk timed out); client auto-resumes.
      return NextResponse.json({ ok: true, done: false, staged: stagedCount ?? undefined, upserted, purging: true, purged })
    }
    // Import finished — let the enrichment cron resume immediately (don't wait
    // for the 20-min staleness fallback). Best-effort.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('system_flags')
        .update({ active: false, updated_at: new Date().toISOString() }).eq('key', 'cc_import_active')
    } catch { /* flag clear is best-effort; it also auto-expires */ }

    return NextResponse.json({
      ok: true,
      done: true,
      staged: stagedCount ?? undefined,
      upserted,
      purged,
    })
  } catch (err) {
    console.error('[import-cc-catalog]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Import failed. Please try again.') }, { status: 500 })
  }
}
