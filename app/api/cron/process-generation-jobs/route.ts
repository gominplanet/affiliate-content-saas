/**
 * GET /api/cron/process-generation-jobs
 *
 * The async generation worker (Phase 4). Fires once a minute (vercel.json).
 * Each tick: atomically claim the next queued job (FOR UPDATE SKIP LOCKED via
 * the claim_generation_job RPC), run it, and record done/failed — repeating up
 * to MAX_PER_TICK so a backlog drains over successive minutes without any one
 * invocation risking the function timeout.
 *
 * Auth: Vercel cron requests carry `Authorization: Bearer ${CRON_SECRET}`.
 * Anything without the matching header is rejected.
 *
 * Safety:
 *  - SKIP LOCKED in the claim RPC means two concurrent ticks never grab the
 *    same job.
 *  - Each claim bumps attempts; failJob re-queues while budget remains, then
 *    marks the job terminally failed — so a poison job can't loop forever.
 *  - Pre-migration 119 (RPC absent) the claim throws; we catch and no-op the
 *    tick cleanly, so shipping the worker before the migration runs is safe.
 *
 * INCREMENT A: the worker + queue are live but no route enqueues jobs yet, so
 * this finds an empty queue and returns {processed:0}. INCREMENT B adds the
 * producer + the real per-kind handlers in lib/generation-job-runner.ts.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { claimNextJob, completeJob, failJob } from '@/lib/generation-jobs'
import { runGenerationJob } from '@/lib/generation-job-runner'

// A blog job invokes the full generation route internally and AWAITS it (up to
// ~290s), so the worker needs the same 300s ceiling the sync generate route
// uses. One heavy job per tick — the every-minute schedule + SKIP LOCKED claim
// let successive ticks run different jobs in parallel, so a backlog still drains
// without any single invocation juggling two long generations.
export const maxDuration = 300
const MAX_PER_TICK = 1

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const processed: Array<{ id: string; ok: boolean; error?: string }> = []

  for (let i = 0; i < MAX_PER_TICK; i++) {
    let job
    try {
      job = await claimNextJob(admin)
    } catch (e) {
      // RPC missing (pre-migration 119) or a transient DB error — end the tick
      // cleanly; next minute tries again.
      return NextResponse.json({
        processed: processed.length,
        jobs: processed,
        note: e instanceof Error ? e.message : 'claim failed',
      })
    }
    if (!job) break // queue empty

    let result
    try {
      result = await runGenerationJob(admin, job)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Client-side timeout/abort: the generate route does NOT abort when we
      // disconnect, so it may still be publishing. Do NOT requeue — a 2nd
      // concurrent run risks a duplicate post. Leave the job 'running'; the
      // stale-claim window (600s, > the route's 300s ceiling) re-runs it only if
      // it truly died, and a re-run UPDATES in place (isRewrite), so no dup.
      if (/^TIMEOUT/i.test(msg)) {
        processed.push({ id: job.id, ok: false, error: 'timeout — left running for stale recovery' })
        continue
      }
      // PERMANENT: deterministic 4xx refusal (review-worthiness gate, caps,
      // validation) — fail terminally on the first attempt instead of
      // replaying the same refusal until the retry budget runs out.
      if (/^PERMANENT:\s*/i.test(msg)) {
        const clean = msg.replace(/^PERMANENT:\s*/i, '')
        await failJob(admin, { ...job, attempts: job.max_attempts }, clean)
        processed.push({ id: job.id, ok: false, error: clean })
        continue
      }
      await failJob(admin, job, msg)
      processed.push({ id: job.id, ok: false, error: msg })
      continue
    }
    // Success. Complete OUTSIDE the run-try so a transient completeJob error
    // can't fall into the failure path and re-run an already-published post. If
    // the status write fails, the job ran + published; a later tick / the stale
    // window reconciles it (the .eq('status','running') guard keeps it safe).
    try {
      await completeJob(admin, job.id, result)
    } catch { /* published already; status write will reconcile */ }
    processed.push({ id: job.id, ok: true })
  }

  return NextResponse.json({ processed: processed.length, jobs: processed })
}
