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

export const maxDuration = 60

// Jobs can be heavy (a full generation). Process a few per tick and leave
// headroom under maxDuration; the backlog drains on subsequent minutes.
const MAX_PER_TICK = 3

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

    try {
      const result = await runGenerationJob(admin, job)
      await completeJob(admin, job.id, result)
      processed.push({ id: job.id, ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await failJob(admin, job, msg)
      processed.push({ id: job.id, ok: false, error: msg })
    }
  }

  return NextResponse.json({ processed: processed.length, jobs: processed })
}
