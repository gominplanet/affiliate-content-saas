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
import { claimNextJob, completeJob, failJob, type GenerationJob } from '@/lib/generation-jobs'
import { runGenerationJob } from '@/lib/generation-job-runner'
import { alertOps } from '@/lib/ops-alert'

// ── Failure-spike alert ─────────────────────────────────────────────────────
// The async queue is live but its failures were operator-invisible (no admin
// surface reads generation_jobs). A systemic break — expired Anthropic key,
// model outage, a poison input pattern — would fail every queued job silently
// until users complained. So when terminal failures cross a threshold in the
// trailing hour, we email + Discord the operator. Throttled per warm instance
// (the once-a-minute cron reuses the same Lambda, so this holds in practice)
// so a sustained incident doesn't alert every tick. Env-tunable threshold.
const FAIL_ALERT_THRESHOLD = Math.max(1, Number(process.env.GENERATION_FAIL_ALERT_THRESHOLD) || 5)
const FAIL_ALERT_THROTTLE_MS = 30 * 60_000
let lastFailAlertAt = 0

async function maybeAlertFailSpike(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  const now = Date.now()
  if (now - lastFailAlertAt < FAIL_ALERT_THROTTLE_MS) return
  const hourAgo = new Date(now - 60 * 60_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin as any)
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('finished_at', hourAgo)
  const failed = count ?? 0
  if (failed >= FAIL_ALERT_THRESHOLD) {
    lastFailAlertAt = now
    await alertOps(
      `Generation failures spiking — ${failed} jobs failed in the last hour`,
      `Threshold is ${FAIL_ALERT_THRESHOLD}. This usually means a systemic break (expired Anthropic key, model outage, WordPress/proxy down, or a bad input pattern) failing every queued job, not isolated user errors. Check recent generation_jobs.error values and the model/API keys.`,
    )
  }
}

// Each blog job invokes the full generation route via an internal HTTP self-call
// and AWAITS it (up to ~290s) — but the heavy generation runs in its OWN function
// invocation, so this worker just holds in-flight fetches (cheap, I/O-bound).
// That lets one tick claim + run several jobs CONCURRENTLY (each claim uses FOR
// UPDATE SKIP LOCKED, so they're distinct and never collide with a sibling tick),
// multiplying drain rate without any single generation juggling another.
//
// CONCURRENCY is env-tunable so throughput can be raised WITHOUT a deploy — bump
// GENERATION_WORKER_CONCURRENCY before a traffic spike. At N, effective start
// rate is ~N jobs/min (the every-minute cron) and ticks still overlap, so the
// queue drains ~N× faster than the old 1-at-a-time worker. Capped at 10 so a
// fat-finger env value can't fan out unbounded concurrent generations.
export const maxDuration = 300
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.GENERATION_WORKER_CONCURRENCY) || 3))

/** Run a single claimed job to completion, returning a result row. Holds the
 *  full timeout / permanent-failure / complete bookkeeping so jobs can run
 *  concurrently. Never throws — always resolves a row. */
async function processOneJob(
  admin: ReturnType<typeof createAdminClient>,
  job: GenerationJob,
): Promise<{ id: string; ok: boolean; error?: string }> {
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
      // MONEY-SAFETY (2026-06-12): a timed-out job left 'running' got re-run by
      // the 600s stale-claim every ~10 min, re-billing a full Opus generation
      // each time. Once the attempts budget is spent, fail it terminally.
      if (job.attempts >= job.max_attempts) {
        await failJob(
          admin,
          { ...job, attempts: job.max_attempts },
          'Generation timed out repeatedly — stopped to avoid re-billing. Try a shorter length or Retry.',
        )
        return { id: job.id, ok: false, error: 'timeout — gave up after max attempts' }
      }
      return { id: job.id, ok: false, error: 'timeout — left running for stale recovery' }
    }
    // PERMANENT: deterministic 4xx refusal (review-worthiness gate, caps,
    // validation) — fail terminally on the first attempt instead of replaying
    // the same refusal until the retry budget runs out.
    if (/^PERMANENT:\s*/i.test(msg)) {
      const clean = msg.replace(/^PERMANENT:\s*/i, '')
      await failJob(admin, { ...job, attempts: job.max_attempts }, clean)
      return { id: job.id, ok: false, error: clean }
    }
    await failJob(admin, job, msg)
    return { id: job.id, ok: false, error: msg }
  }
  // Success. Complete OUTSIDE the run-try so a transient completeJob error can't
  // fall into the failure path and re-run an already-published post. If the
  // status write fails, the job ran + published; a later tick / the stale window
  // reconciles it (the .eq('status','running') guard keeps it safe).
  try {
    await completeJob(admin, job.id, result)
  } catch { /* published already; status write will reconcile */ }
  return { id: job.id, ok: true }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Claim up to CONCURRENCY jobs up front, then run them all in parallel.
  const claimed: GenerationJob[] = []
  let claimNote: string | undefined
  for (let i = 0; i < CONCURRENCY; i++) {
    let job: GenerationJob | null
    try {
      job = await claimNextJob(admin)
    } catch (e) {
      // RPC missing (pre-migration 119) or a transient DB error — stop claiming,
      // process whatever we already hold; next minute tries again.
      claimNote = e instanceof Error ? e.message : 'claim failed'
      break
    }
    if (!job) break // queue empty
    claimed.push(job)
  }

  const settled = await Promise.allSettled(claimed.map(job => processOneJob(admin, job)))
  const processed = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { id: claimed[i].id, ok: false, error: s.reason instanceof Error ? s.reason.message : 'job crashed' },
  )

  // If anything failed this tick, check the trailing-hour failure rate and
  // alert the operator on a spike. Best-effort — never let it break the tick.
  if (processed.some(p => !p.ok)) {
    try { await maybeAlertFailSpike(admin) } catch { /* alerting is best-effort */ }
  }

  return NextResponse.json({
    processed: processed.length,
    jobs: processed,
    ...(claimNote ? { note: claimNote } : {}),
  })
}
