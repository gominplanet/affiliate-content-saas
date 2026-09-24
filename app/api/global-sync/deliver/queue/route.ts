// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/deliver/queue — the creator's pending storefront
// deliveries, for the SCOUT extension to upload into each Amazon storefront via
// the creator's logged-in Creator Hub session. Returns the localized title and
// the market's video (the dub when there is one, else the master render) plus
// the ASIN, per market not yet delivered.
import { dailyRoomFor } from '@/lib/daily-uploads'
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
  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId') || ''

  // ── SCOPE, BECAUSE AN UNSCOPED CALL UPLOADS EVERYTHING ───────────────────
  //
  // With no scope this returns EVERY localized target on the account, which is
  // correct for the storefront board, whose whole job is the standing grid.
  // It was catastrophic for the launch page: a creator picked the US and
  // Germany for a batch, pressed Upload to Amazon, and watched SCOUT open
  // amazon.es, amazon.fr and amazon.it, publishing to storefronts they had
  // never chosen for those videos.
  //
  // So a caller that means "just these" can say so, and the two filters are
  // AND-ed: the videos in this batch, and the countries that batch picked.
  const onlyVideoIds = (url.searchParams.get('videoIds') || '')
    .split(',').map(v => v.trim()).filter(Boolean)
  const onlyDomains = (url.searchParams.get('domains') || '')
    .split(',').map(v => v.trim()).filter(Boolean)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb.from('global_sync_targets')
    .select('id,job_id,domain,lang,title,description,video_url,asin,state,delivered_at,dub')
    .eq('user_id', user.id)
    // A failed listing comes back only when somebody asked to try again: an
    // automatic run must not re-offer what Amazon just refused.
    .in('state', url.searchParams.get('retryFailed') === '1' ? ['localized', 'failed'] : ['localized'])
    .is('delivered_at', null)
  if (jobId) q = q.eq('job_id', jobId)
  if (onlyDomains.length > 0) q = q.in('domain', onlyDomains)

  // THE VIDEO FILTER GOES THROUGH THE JOBS, because a target names its job and
  // the job names the video. An empty result here means "none of these videos
  // have anything queued", which is a real answer and not a reason to fall
  // back to everything: falling back is exactly what published to Spain.
  if (onlyVideoIds.length > 0) {
    const { data: scoped } = await sb.from('global_sync_jobs')
      .select('id').eq('user_id', user.id).in('video_id', onlyVideoIds)
    const ids = (scoped ?? []).map((j: { id: string }) => j.id)
    if (ids.length === 0) return NextResponse.json({ ok: true, items: [], skipped: [], dailyRoom: [] })
    q = q.in('job_id', ids)
  }

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

  let items = rows.map(r => {
    const mkt = marketByDomain(r.domain)
    const vidId = videoIdByJob.get(r.job_id) || ''
    const masterSrc = srcByVideo.get(vidId) || null
    // Non-English storefronts get the text-free thumbnail so no English hook
    // sits on the image; English markets keep the branded (with-text) one. Fall
    // back to the text thumbnail if the clean one isn't ready yet.
    const textThumb = thumbByVideo.get(vidId) || null
    const cleanThumb = cleanThumbByVideo.get(vidId) || null
    const thumb = mkt?.needsTranslation ? (cleanThumb || textThumb) : textThumb
    // SAID, not silent. A non-English store falling back to the branded image
    // gets ENGLISH HOOK TEXT sitting on the thumbnail of a German listing.
    // That is the same shape of failure as the English audio: the upload
    // succeeds, the state says delivered, and the only way anyone finds out is
    // looking at the storefront. The queue still serves it, because a listing
    // with an English-text image beats no listing, but it says which it is.
    const thumbnailIsTextFallback = !!mkt?.needsTranslation && !cleanThumb && !!textThumb
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
      /** True exactly when this non-English store is getting the image with
       *  English text on it because the text-free one was not built. */
      thumbnailIsTextFallback,
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
  // ── AMAZON'S OWN DAILY LIMIT, PER STOREFRONT ─────────────────────────────
  //
  // Twenty a day on the US store, ten on every other one. That is Amazon's
  // rule, not a throttle we invented, and going past it is the kind of thing
  // that gets a Creator account flagged. A batch makes it easy to hit without
  // noticing: ten videos across five countries is fifty uploads in an evening,
  // and until now nothing counted them.
  //
  // PER STOREFRONT, so five countries are five separate allowances and a full
  // France never holds up an empty Japan.
  //
  // A ROLLING TWENTY-FOUR HOURS, not a calendar day. A limit that resets at
  // midnight lets somebody put twenty up at 23:50 and twenty more at 00:10,
  // which is forty in twenty minutes however the calendar describes it.
  // ONE COPY OF THE COUNTING, shared with the screen that reports the room
  // left. Those two disagreeing would be worse than either being wrong alone:
  // the page would promise room this route then refuses, with no explanation
  // anywhere on screen.
  const roomRows = await dailyRoomFor(sb, user.id, rows.map(r => r.domain as string))
  const usedToday = new Map<string, number>(roomRows.map(r => [r.domain, r.used]))

  const overCap: Array<{ domain: string; reason: string }> = []
  const withinCap: typeof items = []
  const takenNow = new Map<string, number>()
  for (const i of items) {
    // ONLY WHAT WILL ACTUALLY GO counts against the day. A listing still
    // waiting on its dub, or missing a title or video, is filtered out after
    // this, and it used to use up the room first: five waiting French dubs
    // ahead of three ready ones meant nothing uploaded and "limit reached".
    if (!i.videoUrl || !i.title || i.audioIsMasterFallback) { withinCap.push(i); continue }
    const mkt = marketByDomain(i.domain)
    const cap = mkt?.dailyUploads ?? 10
    const used = (usedToday.get(i.domain) ?? 0) + (takenNow.get(i.domain) ?? 0)
    const country = mkt?.country ?? i.domain
    if (used >= cap) {
      // NAMED WITH THE NUMBERS. "Try later" tells a creator nothing they can
      // plan around, and a queue that quietly returns fewer items than asked
      // reads on screen as something broken.
      overCap.push({
        domain: i.domain,
        reason: `Amazon's daily limit for ${country} is reached (${used} of ${cap} in the last 24 hours), so this one waits for tomorrow.`,
      })
      continue
    }
    takenNow.set(i.domain, (takenNow.get(i.domain) ?? 0) + 1)
    withinCap.push(i)
  }
  items = withinCap

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

  // The cap cases ride in `skipped`, so a caller that already surfaces skipped
  // markets reports them with no extra work and none of them vanish silently.
  skipped.push(...overCap)

  return NextResponse.json({
    ok: true, items: deliverable, skipped,
    // What is left today, per storefront, so a screen can say "9 more to France
    // today" rather than only speaking up once the wall is hit.
    dailyRoom: roomRows,
  })
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
