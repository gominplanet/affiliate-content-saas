// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/catalogue-scan — work through back-catalogue items a few at a
// time: does this video carry the market's language, and if so, queue it for
// the storefront.
//
// A FEW AT A TIME, on purpose. Each check is one yt-dlp metadata call through
// the residential proxy. A creator with 525 videos is 525 calls, and YouTube's
// bot wall does not tolerate that arriving at once. Trickling also means a run
// starts returning answers immediately instead of after a ten-minute sweep.
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

/** Per invocation. Small enough to stay inside the function budget with room
 *  for a slow lookup, large enough that a 500-video catalogue finishes in a
 *  reasonable number of passes. */
const BATCH = 12

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ingestConfigured()) {
    // Not an error and not a finding about anyone's videos. Saying so beats
    // marking a batch of items ineligible because the downloader is switched off.
    return NextResponse.json({ ok: true, skipped: 'ingest not configured', checked: 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any

  const { data: items } = await sb
    .from('catalogue_run_items')
    .select('id,run_id,user_id,video_id,youtube_video_id')
    .eq('state', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH)

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
      if ((count ?? 0) === 0) {
        await sb.from('catalogue_runs')
          .update({ state: 'ready', updated_at: new Date().toISOString() }).eq('id', r.id)
      }
    }
    return NextResponse.json({ ok: true, checked: 0, closed: (openRuns ?? []).length })
  }

  // The market is per RUN, so resolve them once rather than per item.
  const runIds = [...new Set(rows.map((r: { run_id: string }) => r.run_id))]
  const { data: runs } = await sb.from('catalogue_runs').select('id,domain').in('id', runIds)
  const domainByRun = new Map<string, string>()
  for (const r of (runs ?? [])) domainByRun.set(r.id, r.domain)

  let eligible = 0
  let skipped = 0
  let unknown = 0

  for (const item of rows) {
    const domain = domainByRun.get(item.run_id) || ''
    const market = marketByDomain(domain)
    const lang = (market?.lang || '').split('-')[0].toLowerCase()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (!market || !lang) {
      patch.state = 'skipped'
      patch.reason = 'this run has no usable marketplace'
    } else {
      const { info, reason } = await listYouTubeAudioTracksDetailed(item.youtube_video_id)
      if (!info) {
        // WE COULD NOT LOOK. Left pending on purpose, so the next pass retries
        // it. Marking it skipped would record a verdict about the video from a
        // failure that had nothing to do with the video, and the creator would
        // be told it has no German track when nobody ever checked.
        unknown++
        patch.reason = `could not check yet (${reason ?? 'unknown'})`
        await sb.from('catalogue_run_items').update(patch).eq('id', item.id)
        continue
      }
      if (hasAudioTrack(info, lang)) {
        patch.state = 'eligible'
        patch.reason = null
        eligible++
      } else {
        patch.state = 'skipped'
        patch.reason = `no ${market.langName} audio track on this video`
        skipped++
      }
    }
    await sb.from('catalogue_run_items').update(patch).eq('id', item.id)
  }

  return NextResponse.json({ ok: true, checked: rows.length, eligible, skipped, unknown })
}
