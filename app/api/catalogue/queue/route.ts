// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/catalogue/queue — hand the eligible videos to the storefront pipeline.
//   body: { runId, itemIds? }  ->  { ok, queued, failed }
//
// This is the step that makes the feature a delivery rather than a download.
// Each eligible video gets a normal global-sync job for the run's marketplace,
// so it goes through the same localizing, the same free dub pull, the same
// text-free thumbnail and the same SCOUT upload as a single video would. There
// is no separate back-catalogue code path to drift from the main one.
//
// The final upload still needs SCOUT in the creator's browser, which is what
// makes it their own Creator Hub session rather than ours. So a run PREPARES
// everything unattended and the listings go out when they open the page. At no
// point does a file reach their desktop.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Per call. The caller loops, so a long catalogue makes several requests
 *  rather than one that runs past the function budget and loses its work. */
const BATCH = 25

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Back catalogue is a Pro feature.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { runId?: string; itemIds?: string[] }
  const runId = (body.runId || '').trim()
  if (!runId) return NextResponse.json({ error: 'runId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: run } = await sb.from('catalogue_runs')
    .select('id,domain').eq('id', runId).eq('user_id', user.id).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  let q = sb.from('catalogue_run_items')
    .select('id,video_id').eq('run_id', runId).eq('user_id', user.id).eq('state', 'eligible')
  if (Array.isArray(body.itemIds) && body.itemIds.length > 0) q = q.in('id', body.itemIds)
  const { data: items } = await q.limit(BATCH)

  const rows = Array.isArray(items) ? items : []
  if (rows.length === 0) return NextResponse.json({ ok: true, queued: 0, remaining: 0 })

  const origin = new URL(req.url).origin
  const cookie = req.headers.get('cookie') ?? ''
  let queued = 0
  const failed: Array<{ itemId: string; error: string }> = []

  for (const item of rows) {
    try {
      // The SAME route a single-video sync uses. The ASIN is read from the
      // video row by that route, which is why start/ refuses to queue a video
      // without one rather than discovering it here.
      // EXPLICIT DEADLINE. /api/global-sync/start declares maxDuration 300, so
      // the default 30 second budget would abort us while it carried on and
      // created the job: the outage shape scripts/test-internal-call-budget.ts
      // exists to stop. It answers as soon as the job row is written and does
      // the localizing in the background, so a minute is generous.
      const r = await fetchWithTimeout(`${origin}/api/global-sync/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ videoId: item.video_id, markets: [run.domain] }),
        timeoutMs: 60_000,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.jobId) {
        failed.push({ itemId: item.id, error: String(j?.error || `HTTP ${r.status}`).slice(0, 160) })
        await sb.from('catalogue_run_items').update({
          state: 'failed',
          reason: String(j?.error || `could not start the sync (HTTP ${r.status})`).slice(0, 200),
          updated_at: new Date().toISOString(),
        }).eq('id', item.id)
        continue
      }
      await sb.from('catalogue_run_items').update({
        state: 'queued', sync_job_id: j.jobId, reason: null, updated_at: new Date().toISOString(),
      }).eq('id', item.id)
      queued++
    } catch (e) {
      // A timeout is NOT the same as a refusal, and saying so matters: the
      // request may have created the job before we stopped waiting. Recording
      // a flat "failed" here would invite a re-queue that runs the same video
      // twice.
      const aborted = e instanceof Error && /abort|timed? ?out/i.test(e.name + e.message)
      const msg = aborted
        ? 'the sync did not answer in time, so it may have started anyway; check Storefront Sync before sending it again'
        : (e instanceof Error ? e.message : 'the sync request did not complete')
      failed.push({ itemId: item.id, error: msg.slice(0, 160) })
      await sb.from('catalogue_run_items').update({
        state: 'failed', reason: msg.slice(0, 200), updated_at: new Date().toISOString(),
      }).eq('id', item.id)
    }
  }

  const { count: remaining } = await sb.from('catalogue_run_items')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId).eq('state', 'eligible')

  // `failed` is returned, not just counted. A run that queued 90 of 100 needs
  // to say what happened to the other ten on the screen, or the number is the
  // same useless "37%" this feature exists to replace.
  return NextResponse.json({ ok: true, queued, failed, remaining: remaining ?? 0 })
}
