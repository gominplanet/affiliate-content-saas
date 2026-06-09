/**
 * POST /api/admin/creator-campaigns/import-finalize
 *
 * Runs the two post-upsert cleanup steps after a batched import:
 *   1. Stale-row delete (rows whose imported_at < batchStart — i.e. they
 *      were in the previous catalog but not in this one)
 *   2. recompute_canonical_creator_campaigns RPC (refreshes the
 *      is_canonical flag that the search RPC filters on)
 *
 * Split out from /import-batch on 2026-06-09 because the user hit
 * FUNCTION_INVOCATION_TIMEOUT (504) on a 631K-row catalog — the two
 * cleanup steps together exceeded the 120s import-batch ceiling. They
 * run in their own endpoint now with a 300s budget AND surface per-step
 * timing so a future timeout points at the slow step.
 *
 * Idempotent: safe to call again with the same batchStart if the
 * previous call timed out partway through. The stale delete only ever
 * removes rows < batchStart; the canonical RPC always refreshes from
 * current truth.
 *
 * Body shape:
 *   { batchStart: string }   // ISO timestamp matching the import run
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
// 5-minute ceiling for the cleanup pass. Stale delete on ~600K rows
// runs in well under 2min on Supabase; canonical RPC is index-backed
// so should be <1min. Buffer absorbs DB slowdowns.
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    return await runFinalize(request)
  } catch (e) {
    console.error('[creator-campaigns/import-finalize] uncaught:', e)
    return NextResponse.json({
      error: `Finalize crashed: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 500 })
  }
}

async function runFinalize(request: Request): Promise<NextResponse> {
  // Admin gate (same as import-batch)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { batchStart?: string } | null
  if (!body) return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 })
  const batchStart = (body.batchStart || '').trim()
  if (!batchStart || isNaN(Date.parse(batchStart))) {
    return NextResponse.json({ error: 'Missing/invalid batchStart (must be an ISO timestamp)' }, { status: 400 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // ── Step 1: stale-row delete ──────────────────────────────────────────
  // Anything with imported_at older than batchStart wasn't in this
  // import — prune it.
  //
  // 2026-06-09: routed through delete_stale_creator_campaigns(...) RPC
  // (migration 115) instead of a single bulk DELETE. The bulk version
  // worked fine until catalogs hit ~600K rows, at which point Supabase
  // would cancel the statement at its default per-statement timeout
  // and the user saw "Cleanup failed: canceling statement due to
  // statement timeout". The RPC loops over 25k-row chunks internally
  // so each individual DELETE stays well under that ceiling.
  const t0 = Date.now()
  let staleDeleted: number | null = null
  let cleanupError: string | null = null
  try {
    const { data, error } = await sb.rpc('delete_stale_creator_campaigns', {
      p_batch_start: batchStart,
      p_chunk_size: 25000,
    })
    if (error) cleanupError = error.message
    else if (typeof data === 'number') staleDeleted = data
  } catch (e) {
    cleanupError = e instanceof Error ? e.message : 'unknown delete error'
  }
  const t1 = Date.now()

  // ── Step 2: refresh the is_canonical flag ─────────────────────────────
  // One row per ASIN, highest commission. Search RPC queries WHERE
  // is_canonical = true, so this is what makes new rows actually
  // findable + drops ASINs that no longer have any actionable row.
  let canonicalCount: number | null = null
  let canonicalError: string | null = null
  try {
    const { data: canonical, error: canonErr } = await sb
      .rpc('recompute_canonical_creator_campaigns')
    if (canonErr) canonicalError = canonErr.message
    else if (typeof canonical === 'number') canonicalCount = canonical
  } catch (e) {
    canonicalError = e instanceof Error ? e.message : 'unknown RPC error'
  }
  const t2 = Date.now()

  return NextResponse.json({
    ok: !cleanupError && !canonicalError,
    stale_deleted: staleDeleted,
    stale_cleanup_error: cleanupError,
    canonical_count: canonicalCount,
    canonical_error: canonicalError,
    // Per-step timing so a future timeout points at which step is slow.
    timings_ms: {
      stale_delete: t1 - t0,
      canonical_rpc: t2 - t1,
      total: t2 - t0,
    },
  })
}
