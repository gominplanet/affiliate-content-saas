// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/coverage-drain — keep the coverage grid moving, forever.
//
// THIS REPLACES THE RUN. Nobody starts it, nobody resumes it, there is nothing
// to abandon. A creator ticks the countries they want and this works through
// their catalogue from the most valuable thing not yet done, whether or not any
// page is open. A new video joins the grid the next time this fires.
//
// FOUR STEPS, and each firing does a little of each so nothing starves:
//
//   1. ENROL   every video the creator has, for every market they ticked, gets
//              a row. Once. This is what makes the grid standing rather than a
//              scan somebody has to remember to run.
//   2. PRODUCT the ASIN, from the columns if it is there and by following the
//              description's link if it is not. Cached on the video.
//   3. CHECK   is the product actually sold in that country (Keepa), and does
//              the video already carry that language (YouTube's track list).
//   4. PREPARE hand it to the existing storefront pipeline, which translates,
//              dubs and builds the thumbnail. The cell becomes 'ready'.
//
// RECENCY AND STOCK decide the order, which is what the creator asked for and
// also the only pair that costs nothing to know. Both change on their own, so
// the queue re-sorts itself with nobody maintaining a list.
//
// A LOOKUP THAT FAILED IS NEVER A VERDICT. Every step leaves the cell where it
// was and retries next time rather than recording "cannot go" because a service
// was down. Telling a creator their video cannot reach Germany when nobody
// managed to look is the worst thing this can do.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { marketByDomain } from '@/lib/markets'
import { asinFromAmazonUrl } from '@/lib/asin'
import { resolveAsinFromLinks } from '@/lib/product-link'
import { listYouTubeAudioTracksDetailed, hasAudioTrack, ingestConfigured } from '@/lib/youtube-ingest'
import { coveragePriority } from '@/lib/storefront-coverage'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Videos enrolled per firing. The grid fills over hours rather than in one
 *  request that would run past the function budget on a large channel. */
const ENROL = 400
/** Product links followed. Each is up to five redirect hops. */
const PRODUCTS = 8
/** Track-list lookups. Each is one yt-dlp call through the residential proxy,
 *  and YouTube's bot wall does not tolerate these arriving in bulk. */
const CHECKS = 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Every (video, ticked market) pair that has no row yet. */
async function enrol(sb: Sb): Promise<number> {
  const { data: mkts } = await sb.from('storefront_markets')
    .select('user_id,domain').eq('enabled', true)
  const byUser = new Map<string, string[]>()
  for (const m of (mkts ?? [])) {
    byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.domain])
  }
  if (byUser.size === 0) return 0

  let made = 0
  for (const [userId, domains] of byUser) {
    // Newest first, because that is also the drain order and it puts the most
    // valuable rows in the grid first on a catalogue too big for one pass.
    const { data: vids } = await sb.from('youtube_videos')
      .select('id,published_at,created_at').eq('user_id', userId)
      .order('published_at', { ascending: false, nullsFirst: false }).limit(ENROL)
    const videos = vids ?? []
    if (videos.length === 0) continue

    const { data: have } = await sb.from('storefront_coverage')
      .select('video_id,domain').eq('user_id', userId)
      .in('video_id', videos.map((v: { id: string }) => v.id))
    const seen = new Set((have ?? []).map((h: { video_id: string; domain: string }) => `${h.video_id}:${h.domain}`))

    const rows: Array<Record<string, unknown>> = []
    for (const v of videos) {
      for (const domain of domains) {
        if (seen.has(`${v.id}:${domain}`)) continue
        rows.push({
          user_id: userId, video_id: v.id, domain, state: 'unknown',
          // Stock is not known yet, so this is the recency term alone. The
          // check step adds the stock bonus once it has an answer.
          priority: coveragePriority({ publishedAt: v.published_at ?? v.created_at }),
        })
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      // Conflicts are expected: two firings can overlap on the same catalogue.
      await sb.from('storefront_coverage')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true })
    }
    made += rows.length
  }
  return made
}

/** The ASIN, for videos whose cells have none. */
async function products(sb: Sb): Promise<{ found: number; blocked: number }> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('video_id,user_id').eq('state', 'unknown').is('asin', null)
    .order('priority', { ascending: false }).limit(PRODUCTS * 6)

  // One lookup per VIDEO, not per cell: the answer is the same in every market.
  const byVideo = new Map<string, string>()
  for (const c of (cells ?? [])) {
    if (byVideo.size >= PRODUCTS && !byVideo.has(c.video_id)) continue
    byVideo.set(c.video_id, c.user_id)
  }
  if (byVideo.size === 0) return { found: 0, blocked: 0 }

  const { data: vids } = await sb.from('youtube_videos')
    .select('id,asin,product_url,description').in('id', [...byVideo.keys()])
  let found = 0
  let blocked = 0
  const now = new Date().toISOString()

  for (const v of (vids ?? [])) {
    const text = `${v.product_url ?? ''}\n${v.description ?? ''}`
    let asin: string | null = (v.asin as string | null)?.trim()
      || asinFromAmazonUrl(String(v.product_url ?? ''))
      || asinFromAmazonUrl(String(v.description ?? ''))
      || null

    if (!asin) {
      try {
        // FOLLOWS ANY PRODUCT LINK, whatever the host. A hardcoded list of
        // shorteners reported a creator on a branded Geniuslink domain as
        // having no product on a single video in their catalogue.
        const hit = await resolveAsinFromLinks(text, null, 3)
        asin = hit?.asin ?? null
      } catch {
        // Could not look. Left alone so the next firing retries it.
        continue
      }
    }

    if (!asin) {
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: 'no Amazon product link in this video’s description',
        checked_at: now, updated_at: now,
      }).eq('video_id', v.id).eq('state', 'unknown')
      blocked++
      continue
    }

    // Cached on the video, which is what migration 204 added the column for:
    // the redirect is followed once and every ASIN-keyed feature reads it free.
    await sb.from('youtube_videos').update({ asin }).eq('id', v.id)
    await sb.from('storefront_coverage')
      .update({ asin, updated_at: now }).eq('video_id', v.id).is('asin', null)
    found++
  }
  return { found, blocked }
}

/** Does this video already carry the market's language. */
async function checks(sb: Sb): Promise<{ ready: number; needsDub: number; unknown: number }> {
  if (!ingestConfigured()) return { ready: 0, needsDub: 0, unknown: 0 }

  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,video_id,domain,asin').eq('state', 'unknown').not('asin', 'is', null)
    .order('priority', { ascending: false }).limit(CHECKS * 9)

  // Grouped by video: ONE track-list lookup answers every market at once, so
  // checking per cell pays for the same call up to nine times.
  const groups = new Map<string, Array<{ id: string; domain: string }>>()
  for (const c of (cells ?? [])) {
    if (!groups.has(c.video_id) && groups.size >= CHECKS) continue
    groups.set(c.video_id, [...(groups.get(c.video_id) ?? []), { id: c.id, domain: c.domain }])
  }
  if (groups.size === 0) return { ready: 0, needsDub: 0, unknown: 0 }

  const { data: vids } = await sb.from('youtube_videos')
    .select('id,youtube_video_id,published_at').in('id', [...groups.keys()])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vById = new Map<string, any>()
  for (const v of (vids ?? [])) vById.set(v.id, v)

  let ready = 0, needsDub = 0, unknown = 0
  const now = new Date().toISOString()

  for (const [videoId, cellList] of groups) {
    const v = vById.get(videoId)
    if (!v?.youtube_video_id) {
      await sb.from('storefront_coverage').update({
        state: 'blocked', reason: 'not on YouTube, so there is no audio to pull',
        checked_at: now, updated_at: now,
      }).in('id', cellList.map((c) => c.id))
      continue
    }

    const { info } = await listYouTubeAudioTracksDetailed(v.youtube_video_id)
    if (!info) {
      // NOBODY LOOKED. Left unknown so the next firing retries, never recorded
      // as a finding about the video.
      unknown++
      continue
    }

    for (const cell of cellList) {
      const market = marketByDomain(cell.domain)
      const lang = (market?.lang || '').split('-')[0].toLowerCase()
      const dubbed = !!market && !!lang && hasAudioTrack(info, lang)
      await sb.from('storefront_coverage').update({
        state: 'preparing',
        // Which voice it will ship with, decided here so the screen never has
        // to guess: YouTube's own track when it exists, ours when it does not.
        voice: dubbed ? 'youtube' : 'standard',
        reason: null,
        checked_at: now, updated_at: now,
        // Stock is confirmed by the storefront step; this is the recency term
        // plus a lift for a video that is already dubbed and so costs nothing.
        priority: coveragePriority({ publishedAt: v.published_at, inStock: dubbed }),
      }).eq('id', cell.id)
      if (dubbed) ready++; else needsDub++
    }
  }
  return { ready, needsDub, unknown }
}

/** Videos handed to the storefront pipeline per firing. */
const PREPARE = 6

/**
 * Hand a prepared cell to the existing storefront pipeline.
 *
 * IT CREATES THE JOB AND WALKS AWAY. /api/global-sync/start needs a signed-in
 * creator, and a drain nobody is watching has no session. But the localizing
 * does not need one: /api/cron/drain-global-sync already claims any job that
 * nothing has touched for five minutes and finishes it, which exists because
 * that route's own background loop dies when Vercel freezes the function.
 *
 * So this writes exactly the rows start/ writes and lets the recovery cron do
 * the work. No second pipeline, no internal endpoint to keep in step, and the
 * localizing, the dub and the thumbnail are the same ones a single video gets.
 *
 * One job per video carrying every market it is prepared for, because that
 * pipeline fans out internally and splitting it would re-render the same video
 * once per country.
 */
async function prepare(sb: Sb): Promise<{ sent: number; failed: number }> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,user_id,video_id,domain,asin').eq('state', 'preparing')
    .order('priority', { ascending: false }).limit(PREPARE * 9)

  const groups = new Map<string, { userId: string; asin: string | null; rows: Array<{ id: string; domain: string }> }>()
  for (const c of (cells ?? [])) {
    if (!groups.has(c.video_id) && groups.size >= PREPARE) continue
    const g = groups.get(c.video_id)
      ?? { userId: c.user_id as string, asin: (c.asin as string | null) ?? null, rows: [] as Array<{ id: string; domain: string }> }
    g.rows.push({ id: c.id, domain: c.domain })
    groups.set(c.video_id, g)
  }
  if (groups.size === 0) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0
  const now = new Date().toISOString()

  for (const [videoId, g] of groups) {
    const ids = g.rows.map((r) => r.id)
    const { data: job, error: jobErr } = await sb.from('global_sync_jobs')
      .insert({ user_id: g.userId, video_id: videoId, asin: g.asin, status: 'localizing' })
      .select('id').single()
    if (jobErr || !job) {
      // NAMED, in the database's own words. A bare "failed" is a second screen
      // that knows something broke and not what.
      await sb.from('storefront_coverage').update({
        reason: `could not open a sync job yet (${jobErr?.message ?? 'unknown'})`.slice(0, 200),
        updated_at: now,
      }).in('id', ids)
      failed++
      continue
    }

    const targets = g.rows.map((r) => {
      const mkt = marketByDomain(r.domain)!
      return {
        job_id: job.id, user_id: g.userId, domain: r.domain,
        lang: mkt.lang, dub: mkt.needsTranslation, asin: g.asin, state: 'pending' as const,
      }
    })
    const { error: tErr } = await sb.from('global_sync_targets').insert(targets)
    if (tErr) {
      await sb.from('storefront_coverage').update({
        reason: `could not open the per-country rows yet (${tErr.message})`.slice(0, 200),
        updated_at: now,
      }).in('id', ids)
      failed++
      continue
    }

    await sb.from('storefront_coverage')
      .update({ state: 'ready', sync_job_id: job.id, reason: null, updated_at: now }).in('id', ids)
    sent++
  }
  return { sent, failed }
}

/**
 * Read back what actually happened to everything handed over.
 *
 * READ FROM THE TARGET, not from whoever wrote it. A global_sync_target reaches
 * 'failed' from at least three places and 'delivered' from SCOUT. Teaching each
 * of them about coverage is the twenty-copies mistake; one pass reads the
 * target's state whoever set it.
 *
 * `uploaded` is as far as this can honestly go. SCOUT finished the upload; that
 * is not the same as the video being on the product page, and `live` is set
 * only when it is afterwards found there.
 */
async function reconcile(sb: Sb): Promise<number> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,sync_job_id,domain').in('state', ['ready', 'uploading'])
    .not('sync_job_id', 'is', null).limit(300)
  const rows = cells ?? []
  if (rows.length === 0) return 0

  const { data: targets } = await sb.from('global_sync_targets')
    .select('job_id,domain,state,detail')
    .in('job_id', [...new Set(rows.map((r: { sync_job_id: string }) => r.sync_job_id))])
  const byKey = new Map<string, { state: string; detail: string | null }>()
  for (const t of (targets ?? [])) byKey.set(`${t.job_id}:${t.domain}`, { state: t.state, detail: t.detail })

  let moved = 0
  const now = new Date().toISOString()
  for (const c of rows) {
    const t = byKey.get(`${c.sync_job_id}:${c.domain}`)
    if (!t) continue
    if (t.state === 'delivered') {
      await sb.from('storefront_coverage')
        .update({ state: 'uploaded', reason: null, updated_at: now }).eq('id', c.id)
      moved++
    } else if (t.state === 'failed') {
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: (t.detail || 'the storefront upload failed without saying why').slice(0, 200),
        updated_at: now,
      }).eq('id', c.id)
      moved++
    }
  }
  return moved
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient() as Sb
  // RECONCILE FIRST. A listing that went live is not news that should wait
  // behind a channel enrolment on a catalogue of three thousand.
  const reconciled = await reconcile(sb)
  const enrolled = await enrol(sb)
  const product = await products(sb)
  const checked = await checks(sb)
  const prepared = await prepare(sb)

  return NextResponse.json({ ok: true, reconciled, enrolled, product, checked, prepared })
}
