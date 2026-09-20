// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/catalogue-scan — work through back-catalogue items a few videos
// at a time: which of the run's languages does this video already carry?
//
// ONE LOOKUP PER VIDEO, NOT PER MARKET. The track list yt-dlp returns names
// every language YouTube has dubbed the video into, so a five-market run asks
// once and answers five rows from that. Claiming work per video rather than per
// row is the whole reason the batch is worth anything.
//
// A FEW AT A TIME, on purpose. Each check is one call through the residential
// proxy. A creator with 525 videos is 525 calls, and YouTube's bot wall does not
// tolerate that arriving at once. Trickling also means a run starts returning
// answers immediately instead of after a ten-minute sweep.
//
// The check is metadata only. Nothing is downloaded here and no dub is
// synthesized: this decides eligibility, and the existing sync pipeline does the
// work for the videos that qualify.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { marketByDomain } from '@/lib/markets'
import { listYouTubeAudioTracksDetailed, hasAudioTrack, ingestConfigured } from '@/lib/youtube-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Distinct VIDEOS per invocation, not rows. Small enough to stay inside the
 *  function budget with room for a slow lookup, large enough that a 500-video
 *  catalogue finishes in a reasonable number of passes. */
const BATCH = 12

/** Queued items reconciled per invocation. */
const RECONCILE = 300

/**
 * Copy each queued item's real fate back from the storefront pipeline.
 *
 * WITHOUT THIS THE PILL LIES BY STANDING STILL. Queueing 150 listings set 150
 * items to 'queued' and nothing ever moved them again: a listing that uploaded
 * and a listing whose dub failed both sat there reading "queued", forever, and
 * the run's own screen could not tell the two apart. That is the failure this
 * feature was built to stop, arriving one step later in the pipeline.
 *
 * READ FROM THE TARGET, not from whoever wrote it. A global_sync_target reaches
 * 'failed' from at least three places (the localize pass, the drain cron, and
 * SCOUT's delivery result) and 'delivered' from SCOUT. Teaching each of them
 * about the back catalogue is the twenty-copies-of-the-regex mistake. One pass
 * reads the target's state, whoever set it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcileQueued(sb: any): Promise<number> {
  const { data: queued } = await sb
    .from('catalogue_run_items')
    .select('id,sync_job_id,domain')
    .eq('state', 'queued')
    .not('sync_job_id', 'is', null)
    .limit(RECONCILE)

  const items = Array.isArray(queued) ? queued : []
  if (items.length === 0) return 0

  const jobIds = [...new Set(items.map((i: { sync_job_id: string }) => i.sync_job_id))]
  const { data: targets } = await sb
    .from('global_sync_targets')
    .select('job_id,domain,state,detail')
    .in('job_id', jobIds)

  const byKey = new Map<string, { state: string; detail: string | null }>()
  for (const t of (targets ?? [])) byKey.set(`${t.job_id}:${t.domain}`, { state: t.state, detail: t.detail })

  let moved = 0
  const now = new Date().toISOString()
  for (const item of items) {
    const t = byKey.get(`${item.sync_job_id}:${item.domain}`)
    if (!t) {
      // The job exists but this market has no target row. That is not a
      // delivery failure and not a success, so it is named rather than guessed.
      await sb.from('catalogue_run_items')
        .update({ reason: 'the sync has no job for this store', updated_at: now }).eq('id', item.id)
      continue
    }
    if (t.state === 'delivered') {
      await sb.from('catalogue_run_items')
        .update({ state: 'delivered', reason: null, updated_at: now }).eq('id', item.id)
      moved++
    } else if (t.state === 'failed') {
      await sb.from('catalogue_run_items')
        .update({
          state: 'failed',
          // The pipeline's own words. A generic "failed" here would be a second
          // screen that knows something went wrong and not what.
          reason: (t.detail || 'the storefront sync failed without saying why').slice(0, 200),
          updated_at: now,
        }).eq('id', item.id)
      moved++
    }
    // pending / localizing / dubbing: still in flight, left queued.
  }
  return moved
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any

  // RECONCILE FIRST, and before the ingest check, because this needs no
  // downloader and a creator watching 150 queued listings deserves to see them
  // land even on a day the video service is off.
  const reconciled = await reconcileQueued(sb)

  if (!ingestConfigured()) {
    // Not an error and not a finding about anyone's videos. Saying so beats
    // marking a batch of items ineligible because the downloader is switched off.
    return NextResponse.json({ ok: true, skipped: 'ingest not configured', checked: 0, reconciled })
  }

  // Over-fetch rows, then group: BATCH videos may be several times that many
  // rows when a run targets five markets.
  const { data: items } = await sb
    .from('catalogue_run_items')
    .select('id,run_id,user_id,video_id,youtube_video_id,domain')
    .eq('state', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH * 12)

  const rows = Array.isArray(items) ? items : []
  if (rows.length === 0) {
    // Nothing pending: close out any run whose items are all resolved, so the
    // screen can stop saying "scanning" forever.
    const { data: openRuns } = await sb
      .from('catalogue_runs').select('id').eq('state', 'scanning').limit(20)
    for (const r of (openRuns ?? [])) {
      const { count } = await sb
        .from('catalogue_run_items')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', r.id).eq('state', 'pending')
      // 'ready' means every LOOKUP is done, which is what the scanning spinner
      // is about. Queued items keep resolving after that, so the screen has to
      // go on polling; it keys off the queued count rather than this state.
      if ((count ?? 0) === 0) {
        await sb.from('catalogue_runs')
          .update({ state: 'ready', updated_at: new Date().toISOString() }).eq('id', r.id)
      }
    }
    return NextResponse.json({ ok: true, checked: 0, closed: (openRuns ?? []).length, reconciled })
  }

  // Group by video. Every row for one video shares a single lookup.
  type Row = { id: string; run_id: string; youtube_video_id: string | null; domain: string }
  const byVideo = new Map<string, Row[]>()
  for (const r of rows as Row[]) {
    const key = `${r.run_id}:${r.youtube_video_id ?? ''}`
    if (!byVideo.has(key) && byVideo.size >= BATCH) continue
    const list = byVideo.get(key)
    if (list) list.push(r)
    else byVideo.set(key, [r])
  }

  let eligible = 0
  let skipped = 0
  let unknown = 0
  const now = () => new Date().toISOString()

  for (const group of byVideo.values()) {
    const ytId = group[0].youtube_video_id ?? ''
    const { info, reason } = await listYouTubeAudioTracksDetailed(ytId)

    if (!info) {
      // WE COULD NOT LOOK. Left pending on purpose, so the next pass retries it.
      // Marking it skipped would record a verdict about the video from a failure
      // that had nothing to do with the video, and the creator would be told it
      // has no German track when nobody ever checked.
      unknown++
      for (const row of group) {
        await sb.from('catalogue_run_items')
          .update({ reason: `could not check yet (${reason ?? 'unknown'})`, updated_at: now() })
          .eq('id', row.id)
      }
      continue
    }

    for (const row of group) {
      const market = marketByDomain(row.domain)
      const lang = (market?.lang || '').split('-')[0].toLowerCase()
      if (!market || !lang) {
        await sb.from('catalogue_run_items')
          .update({ state: 'skipped', reason: 'this run has no usable marketplace', updated_at: now() })
          .eq('id', row.id)
        skipped++
        continue
      }
      // THREE ANSWERS, NOT TWO, and the middle one is the whole reason this is
      // worth building into Launchpad rather than leaving as a bulk scanner.
      //
      // A video YouTube has already dubbed is free: /api/global-sync/dub pulls
      // the track instead of synthesizing. A video it has NOT dubbed is not
      // refused, it is the paid lane, the same one the Launchpad stepper has
      // always used. Calling that second case "skipped" told a creator their
      // video could not go to Germany when what was true is that it costs a dub.
      if (hasAudioTrack(info, lang)) {
        await sb.from('catalogue_run_items')
          .update({ state: 'eligible', reason: null, updated_at: now() }).eq('id', row.id)
        eligible++
      } else {
        await sb.from('catalogue_run_items')
          .update({ state: 'paid', reason: `no ${market.langName} audio track, so MVP would dub it`, updated_at: now() })
          .eq('id', row.id)
        skipped++
      }
    }
  }

  return NextResponse.json({ ok: true, checked: byVideo.size, eligible, skipped, unknown, reconciled })
}
