// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/deliver/queue — the creator's pending storefront
// deliveries, for the SCOUT extension to upload into each Amazon storefront via
// the creator's logged-in Creator Hub session. Returns the localized title and
// the market's video (the dub when there is one, else the master render) plus
// the ASIN, per market not yet delivered.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/global-sync'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) return NextResponse.json({ error: 'Pro feature.' }, { status: 403 })

  // Optional ?jobId= to scope to one sync run.
  const jobId = new URL(req.url).searchParams.get('jobId') || ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb.from('global_sync_targets')
    .select('id,job_id,domain,lang,title,description,video_url,asin,state,delivered_at,dub')
    .eq('user_id', user.id)
    .in('state', ['localized'])
    .is('delivered_at', null)
  if (jobId) q = q.eq('job_id', jobId)
  const { data: targets } = await q

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (targets ?? []) as any[]
  if (rows.length === 0) return NextResponse.json({ ok: true, items: [] })

  // Master source video per job (the fallback when a market wasn't dubbed).
  const jobIds = Array.from(new Set(rows.map(r => r.job_id)))
  const { data: jobs } = await sb.from('global_sync_jobs').select('id,video_id').eq('user_id', user.id).in('id', jobIds)
  const videoIdByJob = new Map<string, string>()
  for (const j of (jobs ?? [])) if (j.video_id) videoIdByJob.set(j.id, j.video_id)
  const videoIds = Array.from(new Set([...videoIdByJob.values()]))
  const { data: vids } = videoIds.length
    ? await sb.from('youtube_videos').select('id,source_video_url,thumbnail_url,duration_seconds').eq('user_id', user.id).in('id', videoIds)
    : { data: [] }
  const srcByVideo = new Map<string, string>()
  const thumbByVideo = new Map<string, string>()
  const durByVideo = new Map<string, number>()
  for (const v of (vids ?? [])) {
    if (v.source_video_url) srcByVideo.set(v.id, v.source_video_url)
    if (v.thumbnail_url) thumbByVideo.set(v.id, v.thumbnail_url)
    if (v.duration_seconds) durByVideo.set(v.id, Number(v.duration_seconds) || 0)
  }

  // The text-free thumbnail for non-English markets (migration 306). Read it in
  // a SEPARATE query so an older DB without the column can't break the queue —
  // non-English markets just fall back to the text thumbnail until it exists.
  const cleanThumbByVideo = new Map<string, string>()
  if (videoIds.length) {
    try {
      const { data: cleans } = await sb.from('youtube_videos').select('id,thumbnail_clean_url').eq('user_id', user.id).in('id', videoIds)
      for (const v of (cleans ?? [])) if (v.thumbnail_clean_url) cleanThumbByVideo.set(v.id, v.thumbnail_clean_url)
    } catch { /* column not present yet */ }
  }

  const items = rows.map(r => {
    const mkt = marketByDomain(r.domain)
    const vidId = videoIdByJob.get(r.job_id) || ''
    const masterSrc = srcByVideo.get(vidId) || null
    // Non-English storefronts get the text-free thumbnail so no English hook
    // sits on the image; English markets keep the branded (with-text) one. Fall
    // back to the text thumbnail if the clean one isn't ready yet.
    const textThumb = thumbByVideo.get(vidId) || null
    const thumb = mkt?.needsTranslation ? (cleanThumbByVideo.get(vidId) || textThumb) : textThumb
    return {
      targetId: r.id as string,
      jobId: r.job_id as string,
      domain: r.domain as string,
      market: mkt?.code || r.domain,
      country: mkt?.country || '',
      lang: r.lang as string,
      title: (r.title as string) || '',
      description: (r.description as string) || '',
      asin: (r.asin as string) || null,
      // The dubbed video for a dubbed market; otherwise the master render.
      videoUrl: (r.video_url as string) || masterSrc,
      // The English master, so a market can be delivered without its dub on
      // purpose ("skip dub") even after one was generated.
      masterUrl: masterSrc,
      // Video length, for SCOUT's duplicate check against the storefront.
      durationSeconds: durByVideo.get(vidId) || 0,
      // Per-market thumbnail (clean/text-free for non-English, branded for
      // English), computed above — NOT the raw text thumbnail.
      thumbnailUrl: thumb,
      // ── WHAT THIS MARKET IS ABOUT TO RECEIVE ────────────────────────────
      //
      // `state: 'localized'` only means the TITLE was translated. It is set by
      // the start route the moment the metadata comes back, before any dub
      // exists, so it has never meant "ready to ship".
      //
      // The line above falls back to the English master when a market has no
      // dub. That is correct and deliberate for an English market, and for a
      // creator who chose "skip dub". It is also what happens when a dub FAILED,
      // and those three are indistinguishable from here: same URL shape, same
      // state, same delivered_at afterwards. A French storefront ends up with a
      // French title over English audio and nothing anywhere disagrees.
      //
      // So the queue says which it is and lets the caller decide. It does not
      // withhold the item: a market delivered with English audio on purpose is a
      // real choice, and refusing to serve it would break the English geos and
      // the skip-dub path both.
      needsDub: !!r.dub,
      dubbed: !!r.video_url,
      // True exactly when this market wanted its own audio and is not getting
      // it. The one field a caller has to look at to avoid shipping a silent
      // language failure.
      audioIsMasterFallback: !!r.dub && !r.video_url,
    }
  })

  // ── MARKETS THAT CANNOT BE DELIVERED ARE NAMED, NOT DROPPED ──────────────
  //
  // This used to end in .filter(i => i.videoUrl && i.title), which removed any
  // market missing either. The caller toasts when the queue comes back EMPTY,
  // so an all-dropped wave was caught. A partial drop was not: pick five
  // markets, have one come back without a title, and the run finishes on
  // "Uploaded to 4 of 4 storefronts", which reads as complete.
  const deliverable = items.filter(i => !!i.videoUrl && !!i.title)
  const skipped = items
    .filter(i => !i.videoUrl || !i.title)
    .map(i => ({
      domain: i.domain,
      reason: !i.title
        ? 'no localized title, so the localize step did not finish for this market'
        : 'no video to upload, and no master render to fall back on',
    }))

  // ── THE MARKETS THIS QUERY CANNOT EVEN SEE ───────────────────────────────
  //
  // Everything above starts from `state: 'localized'`, so a target that never
  // got there is not skipped, it is ABSENT. The caller then has nothing to
  // report but "it never reached the upload queue", which is a description of
  // the queue rather than of what went wrong, and the market's card stays
  // blank: identical to a market nobody asked for.
  //
  // A German dub that stopped part-way left its target in 'dubbing' and the
  // whole run said "1 never got as far as an upload", with no name and no
  // reason anywhere on screen.
  //
  // Only for a scoped read. Unscoped, this would sweep every unfinished target
  // the creator has ever had, and the board that calls it that way reads
  // `items` alone.
  if (jobId) {
    const { data: stalled } = await sb.from('global_sync_targets')
      .select('domain,state,detail')
      .eq('user_id', user.id).eq('job_id', jobId)
      .is('delivered_at', null).not('state', 'in', '("localized","delivered")')
    for (const r of (stalled ?? [])) {
      skipped.push({ domain: r.domain as string, reason: stalledReason(r.state, r.detail) })
    }
  }

  return NextResponse.json({ ok: true, items: deliverable, skipped })
}

/** Why a target never reached the queue, in the pipeline's own words where it
 *  left any. Every branch names something the creator can act on, because
 *  "not localized" tells them only that it is not here. */
function stalledReason(state: string, detail: string | null): string {
  const said = (detail || '').trim()
  switch (state) {
    case 'pending':
      return 'the title and description have not been translated yet, so nothing was ready to upload'
    case 'dubbing':
      return said
        ? `the dub did not finish (${said})`
        : 'the dub started and did not finish, so this market has no audio yet. Press Generate dub to try it again.'
    case 'failed':
      return said || 'this market failed earlier in the pipeline and recorded no reason'
    default:
      return `this market is sitting at "${state}", which is not a state the upload queue serves`
  }
}
