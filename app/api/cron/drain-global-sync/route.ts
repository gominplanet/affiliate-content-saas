// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/drain-global-sync  (Vercel cron, every minute)
//
// Finishes Storefront Sync jobs that nobody is driving.
//
// /api/global-sync/start localizes each market in a `void (async () => …)()`
// that runs AFTER the response is sent. On Vercel the function can be frozen the
// moment the response goes out, so that loop is not guaranteed to run. Nothing
// reconciled the outcome: no cron touched these tables, the failure path stored
// no reason, and a job that died mid-localize just stayed `localizing`.
//
// Production had four stuck jobs against 27 finished, the oldest sitting since
// 1 September. About one run in eight left a creator watching a spinner that
// would never resolve.
//
// This is the reconciler. It claims stalled jobs, localizes their remaining
// markets, and closes them out. The request path keeps its head start, so a
// normal run still completes in seconds; this only picks up what that dropped.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { marketByDomain, localizeMetadata } from '@/lib/global-sync'
import { decideRecovery, STALL_AFTER_MS, type JobSnapshot } from '@/lib/global-sync-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Jobs inspected per tick. Small: the cron runs every minute and a backlog of
 *  stalled syncs is measured in single digits, not thousands. */
const MAX_JOBS = 5
/** Wall-clock budget, well under maxDuration so a slow market cannot get the
 *  whole tick killed mid-write. */
const DEADLINE_MS = 240_000

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()
  const deadline = Date.now() + DEADLINE_MS
  const results: Array<{ job: string; action: string; markets?: number; error?: string }> = []

  // Candidates: unfinished jobs that nothing has touched recently. The idle
  // window is applied in SQL so a job still being localized by its own request
  // is never claimed out from under it.
  const staleBefore = new Date(Date.now() - STALL_AFTER_MS).toISOString()
  const { data: jobs, error: jobsErr } = await admin
    .from('global_sync_jobs')
    .select('id,user_id,video_id,status,created_at,updated_at,recovery_attempts')
    .in('status', ['queued', 'localizing', 'delivering'])
    .lt('updated_at', staleBefore)
    .order('updated_at', { ascending: true })
    .limit(MAX_JOBS)
  if (jobsErr) {
    // A missing recovery_attempts column (migration 327 not applied) is the one
    // cause worth naming, because everything else here is fine and the fix is
    // one migration.
    const needsMigration = /recovery_attempts|column .* does not exist/i.test(jobsErr.message || '')
    return NextResponse.json({
      ok: false,
      error: needsMigration
        ? 'Run migration 327 in Supabase to enable Storefront Sync recovery.'
        : jobsErr.message,
    }, { status: 500 })
  }
  if (!jobs?.length) return NextResponse.json({ ok: true, idle: true })

  for (const job of jobs) {
    if (Date.now() > deadline) break
    try {
      // Only the markets that still have no copy. Re-localizing one that already
      // has a title would spend a model call to overwrite good output.
      const { data: pending } = await admin
        .from('global_sync_targets')
        .select('id,domain,lang,state')
        .eq('job_id', job.id)
        .eq('state', 'pending')

      const snapshot: JobSnapshot = {
        status: job.status,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        pendingTargets: (pending ?? []).length,
        attempts: Number(job.recovery_attempts ?? 0),
      }
      const decision = decideRecovery(snapshot)

      if (decision.action === 'wait') { results.push({ job: job.id, action: 'wait' }); continue }

      if (decision.action === 'fail') {
        await admin.from('global_sync_jobs')
          .update({ status: 'failed', error: decision.reason, updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ job: job.id, action: 'failed' })
        continue
      }

      // ── resume ──────────────────────────────────────────────────────────
      // Count the attempt BEFORE doing the work. Counting after means a job
      // that dies mid-localize every time is retried forever, which is the
      // failure this whole route exists to stop repeating.
      await admin.from('global_sync_jobs')
        .update({ recovery_attempts: Number(job.recovery_attempts ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', job.id)

      const { data: video } = await admin
        .from('youtube_videos')
        .select('title,generated_title,description,generated_description')
        .eq('id', job.video_id).maybeSingle()
      const { data: brand } = await admin
        .from('brand_profiles')
        .select('learn_profile,voice_fingerprint,channel_voice_fingerprints')
        .eq('user_id', job.user_id).maybeSingle()
      const { data: integ } = await admin
        .from('integrations').select('tier').eq('user_id', job.user_id).maybeSingle()

      const masterTitle = ((video?.generated_title as string) || (video?.title as string) || '').trim()
      const masterDesc = ((video?.generated_description as string) || (video?.description as string) || '').trim()

      let done = 0
      for (const t of (pending ?? [])) {
        if (Date.now() > deadline) break
        const mkt = marketByDomain(t.domain)
        if (!mkt) {
          // A domain we no longer support. Fail the target rather than leaving
          // it pending forever and holding the whole job open with it.
          await admin.from('global_sync_targets')
            .update({ state: 'failed', detail: 'This marketplace is no longer supported.', updated_at: new Date().toISOString() })
            .eq('id', t.id)
          continue
        }
        try {
          const meta = await localizeMetadata(
            { title: masterTitle, description: masterDesc }, mkt,
            brand as { learn_profile?: unknown; voice_fingerprint?: string | null; channel_voice_fingerprints?: unknown },
            { userId: job.user_id, tier: integ?.tier ?? null },
          )
          await admin.from('global_sync_targets')
            .update({ title: meta.title, description: meta.description, state: 'localized', updated_at: new Date().toISOString() })
            .eq('id', t.id)
          done++
        } catch (e) {
          // Per-market, so one bad market cannot cost the other four. The reason
          // lands on the target where the page can show it.
          await admin.from('global_sync_targets')
            .update({ state: 'failed', detail: (e instanceof Error ? e.message : 'Localizing failed.').slice(0, 300), updated_at: new Date().toISOString() })
            .eq('id', t.id)
        }
      }

      // Done when nothing is pending any more. Checked against the DB rather
      // than assumed from the loop, because the deadline can cut the loop short
      // and a job closed early would strand its remaining markets.
      const { count: stillPending } = await admin
        .from('global_sync_targets')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', job.id).eq('state', 'pending')
      if ((stillPending ?? 0) === 0) {
        await admin.from('global_sync_jobs')
          .update({ status: 'done', error: null, updated_at: new Date().toISOString() })
          .eq('id', job.id)
      }
      results.push({ job: job.id, action: 'resumed', markets: done })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unexpected error'
      console.error('[drain-global-sync]', job.id, msg)
      // Record it on the job. The original failure path wrote status='failed'
      // and no reason, which is how a creator ends up with a dead sync and
      // nothing to act on.
      try {
        await admin.from('global_sync_jobs')
          .update({ error: msg.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', job.id)
      } catch { /* best-effort */ }
      results.push({ job: job.id, action: 'error', error: msg })
    }
  }

  return NextResponse.json({ ok: true, inspected: results.length, results })
}
