/**
 * POST /api/admin/creator-campaigns/import-batch
 *
 * Bulk-upserts a single pre-parsed batch of rows into
 * `creator_connections_catalog`. Replaces the legacy single-call import
 * route (/api/admin/creator-campaigns/import) — that route parsed the
 * whole zip server-side and ran ~870 sequential upserts on the 436K-row
 * weekly export, which exceeded Vercel's 5-min function ceiling
 * (FUNCTION_INVOCATION_TIMEOUT).
 *
 * New flow:
 *   1. Browser parses the .zip with jszip + streams every .csv into rows
 *   2. Browser POSTs the rows in batches (2k rows/call). Each call here
 *      handles a few seconds of upsert work — well under the timeout.
 *   3. The FINAL batch passes { isFinal: true }, which triggers the
 *      stale-row cleanup (anything not touched during this import is
 *      pruned).
 *
 * Body shape:
 *   {
 *     rows:  Row[]            // up to ~2000 rows per call
 *     batchStart: string      // ISO timestamp shared across every call
 *                             // in one import run; used both as
 *                             // imported_at and as the cleanup cutoff
 *                             // on the final batch.
 *     isFinal: boolean        // when true, runs the stale-row delete
 *                             // after this batch's upsert lands.
 *   }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
// Each batch is ~2k rows so 60s is plenty. We keep the headroom in
// case Postgres temporarily slows under load.
export const maxDuration = 120

type Row = {
  asin: string
  campaign_id: string
  campaign_name: string | null
  brand: string | null
  commission: number | null
  ends_at: string | null
  days_left: number | null
  budget_remain: number
  slots_available: number
  has_budget_and_slots: boolean
}

export async function POST(request: Request) {
  try {
    return await runBatch(request)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[creator-campaigns/import-batch] uncaught:', e)
    return NextResponse.json({
      error: `Import batch crashed: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 500 })
  }
}

async function runBatch(request: Request): Promise<NextResponse> {
  // ── Admin gate ────────────────────────────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    rows?: Row[]
    batchStart?: string
    isFinal?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 })

  const rows = Array.isArray(body.rows) ? body.rows : []
  const batchStart = (body.batchStart || '').trim()
  const isFinal = !!body.isFinal
  if (!batchStart || isNaN(Date.parse(batchStart))) {
    return NextResponse.json({ error: 'Missing/invalid batchStart (must be an ISO timestamp)' }, { status: 400 })
  }
  // A final batch with zero rows is legal — that just triggers the
  // cleanup of any rows older than batchStart and is how the client
  // gracefully ends an import that already finished sending data.
  if (!isFinal && rows.length === 0) {
    return NextResponse.json({ error: 'Empty batch (rows required unless isFinal=true)' }, { status: 400 })
  }
  if (rows.length > 5000) {
    return NextResponse.json({ error: 'Batch too large (>5000 rows). Split client-side.' }, { status: 413 })
  }

  // ── Upsert this batch in 500-row sub-chunks (Postgres statement-timeout
  //    headroom — same logic as the legacy single-call route but only
  //    runs for THIS batch's rows, not all 436K). ─────────────────────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const SUB = 500
  let upserted = 0
  const failed: Array<{ start: number; end: number; error: string }> = []

  for (let i = 0; i < rows.length; i += SUB) {
    const chunk = rows.slice(i, i + SUB).map(r => ({ ...r, imported_at: batchStart }))
    const { error } = await sb
      .from('creator_connections_catalog')
      .upsert(chunk, { onConflict: 'campaign_id,asin' })
    if (error) {
      failed.push({ start: i, end: i + chunk.length, error: error.message })
      // Don't fail the whole batch — the client can retry just this
      // slice. Most chunk failures are transient (timeout, deadlock).
      continue
    }
    upserted += chunk.length
  }

  // ── Stale-row cleanup (final batch only) ──────────────────────────────
  // Anything with imported_at older than batchStart is from a previous
  // upload and didn't show up in this one. Prune it.
  let staleDeleted: number | null = null
  let cleanupError: string | null = null
  let canonicalCount: number | null = null
  let canonicalError: string | null = null
  if (isFinal) {
    const { error, count } = await sb
      .from('creator_connections_catalog')
      .delete({ count: 'exact' })
      .lt('imported_at', batchStart)
    if (error) cleanupError = error.message
    else staleDeleted = count ?? 0

    // Refresh the is_canonical flag (one row per ASIN, highest
    // commission). Search RPC queries WHERE is_canonical = true, so
    // this is what makes new rows actually findable + drops any
    // ASINs that have no actionable row in this import. Cheap: two
    // UPDATEs in the function, both index-backed.
    const { data: canonical, error: canonErr } = await sb
      .rpc('recompute_canonical_creator_campaigns')
    if (canonErr) canonicalError = canonErr.message
    else if (typeof canonical === 'number') canonicalCount = canonical
  }

  return NextResponse.json({
    ok: true,
    upserted,
    failed_chunks: failed,
    ...(isFinal ? {
      stale_deleted: staleDeleted,
      stale_cleanup_error: cleanupError,
      canonical_count: canonicalCount,
      canonical_error: canonicalError,
    } : {}),
  })
}
