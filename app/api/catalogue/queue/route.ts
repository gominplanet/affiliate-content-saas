// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/catalogue/queue — hand the eligible videos to the storefront pipeline.
//   body: { runId, domain? }  ->  { ok, queued, failed, remaining }
//
// This is the step that makes the feature a delivery rather than a download.
// Each eligible video gets a normal global-sync job, so it goes through the same
// localizing, the same free dub pull, the same text-free thumbnail and the same
// SCOUT upload as a single video would. There is no separate back-catalogue code
// path to drift from the main one.
//
// ONE JOB PER VIDEO, carrying every market that video qualified for. A video
// YouTube dubbed into German and French is one job for both stores, not two
// jobs: /api/global-sync/start takes a list of markets and fans out internally,
// so splitting it here would duplicate the localizing work and the thumbnail.
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

/** Videos per call. The caller loops, so a long catalogue makes several requests
 *  rather than one that runs past the function budget and loses its work. */
const BATCH = 25

type Row = { id: string; video_id: string; domain: string; asin: string | null }

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Back catalogue is a Pro feature.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as {
    runId?: string; domain?: string; itemIds?: string[]; includePaid?: boolean
  }
  const runId = (body.runId || '').trim()
  if (!runId) return NextResponse.json({ error: 'runId is required.' }, { status: 400 })
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter(Boolean) : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: run } = await sb.from('catalogue_runs')
    .select('id').eq('id', runId).eq('user_id', user.id).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  // WHAT COUNTS AS SENDABLE.
  //
  // 'eligible' is a video YouTube already dubbed, so the track is pulled and it
  // costs nothing. 'paid' is one it did not, which MVP can still dub through the
  // same lane Launchpad has always used, for a dub credit. The paid ones are
  // never swept up by a bulk press: they only go when the creator picked those
  // pills, or explicitly asked for them.
  const states = (itemIds.length > 0 || body.includePaid) ? ['eligible', 'paid'] : ['eligible']

  let q = sb.from('catalogue_run_items')
    .select('id,video_id,domain,asin')
    .eq('run_id', runId).eq('user_id', user.id).in('state', states)
    .order('video_id', { ascending: true })
  // A creator can send one store at a time, or hand-pick single pills, rather
  // than committing the whole catalogue to every market in one press.
  if (itemIds.length > 0) q = q.in('id', itemIds.slice(0, 500))
  else if (body.domain) q = q.eq('domain', body.domain)
  const { data: items } = await q.limit(BATCH * 10)

  const rows: Row[] = Array.isArray(items) ? items : []
  if (rows.length === 0) return NextResponse.json({ ok: true, queued: 0, remaining: 0, failed: [] })

  // Group by video, capped at BATCH videos so the request stays inside budget.
  const byVideo = new Map<string, Row[]>()
  for (const r of rows) {
    if (!byVideo.has(r.video_id) && byVideo.size >= BATCH) continue
    const list = byVideo.get(r.video_id)
    if (list) list.push(r)
    else byVideo.set(r.video_id, [r])
  }

  const origin = new URL(req.url).origin
  const cookie = req.headers.get('cookie') ?? ''
  let queued = 0
  const failed: Array<{ videoId: string; error: string }> = []
  const now = () => new Date().toISOString()

  for (const [videoId, group] of byVideo) {
    const ids = group.map((r) => r.id)
    const markets = group.map((r) => r.domain)
    try {
      // EXPLICIT DEADLINE. /api/global-sync/start declares maxDuration 300, so
      // the default 30 second budget would abort us while it carried on and
      // created the job: the outage shape scripts/test-internal-call-budget.ts
      // exists to stop. It answers as soon as the job row is written and does
      // the localizing in the background, so a minute is generous.
      const r = await fetchWithTimeout(`${origin}/api/global-sync/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        // The ASIN resolved at enumeration time is passed through, so the job
        // does not have to resolve it a second time and cannot disagree with
        // what the run reported as eligible.
        body: JSON.stringify({ videoId, markets, asin: group[0].asin || undefined }),
        timeoutMs: 60_000,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.jobId) {
        const msg = String(j?.error || `could not start the sync (HTTP ${r.status})`).slice(0, 200)
        failed.push({ videoId, error: msg.slice(0, 160) })
        await sb.from('catalogue_run_items')
          .update({ state: 'failed', reason: msg, updated_at: now() }).in('id', ids)
        continue
      }
      await sb.from('catalogue_run_items')
        .update({ state: 'queued', sync_job_id: j.jobId, reason: null, updated_at: now() }).in('id', ids)
      queued += ids.length
    } catch (e) {
      // A timeout is NOT the same as a refusal, and saying so matters: the
      // request may have created the job before we stopped waiting. Recording a
      // flat "failed" here would invite a re-queue that runs the same video twice.
      const aborted = e instanceof Error && /abort|timed? ?out/i.test(e.name + e.message)
      const msg = aborted
        ? 'the sync did not answer in time, so it may have started anyway; check Storefront Sync before sending it again'
        : (e instanceof Error ? e.message : 'the sync request did not complete')
      failed.push({ videoId, error: msg.slice(0, 160) })
      await sb.from('catalogue_run_items')
        .update({ state: 'failed', reason: msg.slice(0, 200), updated_at: now() }).in('id', ids)
    }
  }

  let rq = sb.from('catalogue_run_items')
    .select('id', { count: 'exact', head: true }).eq('run_id', runId).in('state', states)
  if (itemIds.length > 0) rq = rq.in('id', itemIds.slice(0, 500))
  else if (body.domain) rq = rq.eq('domain', body.domain)
  const { count: remaining } = await rq

  // `failed` is returned, not just counted. A run that queued 90 of 100 needs to
  // say what happened to the other ten on the screen, or the number is the same
  // useless "37%" this feature exists to replace.
  return NextResponse.json({ ok: true, queued, videos: byVideo.size, failed, remaining: remaining ?? 0 })
}
