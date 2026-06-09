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

  // ── Step 1: stale-row delete (chunked in TypeScript) ──────────────────
  // Anything with imported_at older than batchStart wasn't in this
  // import — prune it.
  //
  // 2026-06-09 v2: the migration-115 RPC approach was the right shape
  // but the wrong layer. SET LOCAL statement_timeout INSIDE a PL/pgSQL
  // function doesn't override the per-call statement_timeout that
  // PostgREST applies to the OUTER `SELECT my_func()` call — that one
  // is already running when SET LOCAL fires. So a function that
  // internally takes 75s still gets killed at the role's
  // statement_timeout.
  //
  // The reliable fix is to chunk in TypeScript instead. Each
  // individual SELECT + DELETE is small (5k ids) and finishes in ~1-2s,
  // well under any timeout. We loop until we've drained the stale set
  // or hit our 250s soft budget (leaves ~50s for the canonical RPC).
  const t0 = Date.now()
  const STALE_DELETE_BUDGET_MS = 250_000
  const STALE_DELETE_CHUNK = 5000
  let staleDeleted = 0
  let cleanupError: string | null = null
  try {
    let loops = 0
    while (true) {
      if (Date.now() - t0 > STALE_DELETE_BUDGET_MS) {
        cleanupError = `Hit time budget (${STALE_DELETE_BUDGET_MS / 1000}s) after ${staleDeleted.toLocaleString()} rows. Click "Retry cleanup" to continue from where we stopped.`
        break
      }
      loops++
      const { data: victims, error: selErr } = await sb
        .from('creator_connections_catalog')
        .select('id')
        .lt('imported_at', batchStart)
        .limit(STALE_DELETE_CHUNK)
      if (selErr) { cleanupError = `Select chunk #${loops}: ${selErr.message}`; break }
      if (!victims || victims.length === 0) break
      const ids = (victims as Array<{ id: string }>).map(v => v.id)
      const { error: delErr } = await sb
        .from('creator_connections_catalog')
        .delete()
        .in('id', ids)
      if (delErr) { cleanupError = `Delete chunk #${loops}: ${delErr.message}`; break }
      staleDeleted += ids.length
    }
  } catch (e) {
    cleanupError = e instanceof Error ? e.message : 'unknown delete error'
  }
  const t1 = Date.now()

  // ── Step 2: refresh the is_canonical flag ─────────────────────────────
  // One row per ASIN, highest commission. Search RPC queries WHERE
  // is_canonical = true, so this is what makes new rows actually
  // findable + drops ASINs that no longer have any actionable row.
  //
  // 2026-06-09: SKIP this step when stale cleanup failed or didn't
  // finish. Two reasons:
  //   1. The canonical RPC reads the whole catalog — if there are still
  //      hundreds of thousands of stale rows lingering, it'll process
  //      them too and waste budget. Better to drain stale first.
  //   2. The user clicks "Retry cleanup" to make progress — running
  //      canonical inside a partially-completed cleanup adds noise to
  //      the error message that obscures the real status.
  // Once cleanup reports staleDeleted with no error, the NEXT retry
  // will run canonical with a clean slate (no stale rows visible).
  let canonicalCount: number | null = null
  let canonicalError: string | null = null
  if (cleanupError) {
    canonicalError = 'Skipped (stale cleanup not finished — click Retry cleanup again to continue, then canonical will run).'
  } else {
    try {
      const { data: canonical, error: canonErr } = await sb
        .rpc('recompute_canonical_creator_campaigns')
      if (canonErr) canonicalError = canonErr.message
      else if (typeof canonical === 'number') canonicalCount = canonical
    } catch (e) {
      canonicalError = e instanceof Error ? e.message : 'unknown RPC error'
    }
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
