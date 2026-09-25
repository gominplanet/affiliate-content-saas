// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET    /api/launch/batches/[id] — the batch, its videos, and which step the
//                                   creator should do next.
// PATCH  /api/launch/batches/[id] — the shared decisions: CTA, countries,
//                                   cadence, name.
// DELETE /api/launch/batches/[id] — bin a batch that has not launched.
//
// THE STEPS COME FROM lib/launch-batch, not from this route and not from the
// page. One place decides what "done" means, so a screen cannot say ready
// about a batch the worker will refuse.

import { launchReadiness } from '@/lib/launch-readiness'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'
import { normalizeSlots } from '@/lib/launch-schedule'
import { validateThumbnailPreset } from '@/lib/thumbnail-preset'
import { normalizeStudioOptions, readStudioRun } from '@/lib/studio-finish'
import { batchSteps, launchBlocker, validateCtaPreset, withOwnSchedules, withYouTubeChoice, MAX_ITEMS, type BatchRow, type ItemRow, BATCH_COLUMNS, ITEM_COLUMNS } from '@/lib/launch-batch'

export const runtime = 'nodejs'


export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch, error } = await sb.from('launch_batches')
    .select(BATCH_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
  if (error) {
    return NextResponse.json({
      error: 'Could not read this batch. Run migrations 357 and 358, then reload.',
      detail: error.message,
    }, { status: 500 })
  }
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const { data: rows } = await sb.from('launch_items')
    .select(ITEM_COLUMNS).eq('batch_id', id).order('position', { ascending: true })
  const { items, available: ownSchedules } = await withOwnSchedules(sb, id, (rows ?? []) as ItemRow[])
  // The notify toggle, read on its own: before migration 366 the column does
  // not exist, and folding it into BATCH_COLUMNS would fail the whole batch.
  const { data: nrow, error: nerr } = await sb.from('launch_batches')
    .select('notify_subscribers').eq('id', id).eq('user_id', user.id).maybeSingle()
  const notifyAvailable = !nerr
  const notifySubscribers = !nerr && nrow?.notify_subscribers === true

  // THE YOUTUBE OPTIONS (migration 367), read on their own for the same
  // reason: before the SQL runs these columns do not exist, and a failed
  // select must not empty the batch. `youtubeOptionsAvailable: false` makes
  // the page say so instead of offering a playlist nobody would add to.
  const { data: yrow, error: yerr } = await sb.from('launch_batches')
    .select('playlist_id,studio_options').eq('id', id).eq('user_id', user.id).maybeSingle()
  const youtubeOptionsAvailable = !yerr
  const { data: irows, error: ierr } = await sb.from('launch_items')
    .select('id,playlist_added_at,playlist_error,studio_finish').eq('batch_id', id)
  const extra = new Map<string, { playlist_added_at: string | null; playlist_error: string | null; studio_finish: unknown }>()
  if (!ierr) for (const r of (irows ?? []) as Array<{ id: string; playlist_added_at: string | null; playlist_error: string | null; studio_finish: unknown }>) extra.set(r.id, r)
  // ── AMAZON, PER VIDEO, PER COUNTRY, AS RECORDED ──────────────────────────
  // The board said "handed to Amazon" and nothing else, so a batch whose every
  // upload failed looked the same as one that went up. Each row now carries
  // each country's own state and, for a failure, SCOUT's reason. Read-only and
  // best effort: a failure here leaves the list empty, never the batch.
  const amazonByVideo = new Map<string, Array<{ domain: string; state: string; detail: string | null; waitingOnDub: boolean }>>()
  const vids = items.map((i) => i.video_id).filter((v): v is string => !!v)
  if (vids.length) {
    const { data: jobs } = await sb.from('global_sync_jobs').select('id,video_id').eq('user_id', user.id).in('video_id', vids)
    const videoByJob = new Map<string, string>()
    for (const j of (jobs ?? []) as Array<{ id: string; video_id: string }>) videoByJob.set(j.id, j.video_id)
    if (videoByJob.size) {
      const { data: targets } = await sb.from('global_sync_targets')
        .select('job_id,domain,state,detail,dub,video_url').eq('user_id', user.id).in('job_id', [...videoByJob.keys()])
      const wanted = new Set((batch as BatchRow).markets ?? [])
      for (const t of (targets ?? []) as Array<{ job_id: string; domain: string; state: string; detail: string | null; dub: unknown; video_url: string | null }>) {
        if (wanted.size && !wanted.has(t.domain)) continue
        const v = videoByJob.get(t.job_id)
        if (!v) continue
        const list = amazonByVideo.get(v) ?? []
        list.push({ domain: t.domain, state: t.state, detail: t.detail, waitingOnDub: !!t.dub && !t.video_url })
        amazonByVideo.set(v, list)
      }
    }
    // EVERY COUNTRY THE BATCH PICKED, NOT ONLY THE ONES WITH A LISTING. A
    // country the coverage grid stopped before it made a listing (the product
    // is not sold there, say) had no row at all, so a video meant for seven
    // countries showed one and said nothing about the other six. Those come
    // from the grid, with its own state and reason.
    const { data: cells } = await sb.from('storefront_coverage')
      .select('video_id,domain,state,reason').eq('user_id', user.id).in('video_id', vids)
    for (const c of (cells ?? []) as Array<{ video_id: string; domain: string; state: string; reason: string | null }>) {
      if (!((batch as BatchRow).markets ?? []).includes(c.domain)) continue
      const list = amazonByVideo.get(c.video_id) ?? []
      if (list.some((a) => a.domain === c.domain)) continue
      list.push({ domain: c.domain, state: `grid:${c.state}`, detail: c.reason, waitingOnDub: false })
      amazonByVideo.set(c.video_id, list)
    }
  }

  // WHAT YOUTUBE CONFIRMED about each video's disclosures (migration 368),
  // on its own so the batch still loads before that SQL is run.
  const disclosuresById = new Map<string, unknown>()
  {
    const { data: drows, error: derr } = await sb.from('launch_items').select('id,api_disclosures').eq('batch_id', id)
    if (!derr) for (const r of (drows ?? []) as Array<{ id: string; api_disclosures: unknown }>) disclosuresById.set(r.id, r.api_disclosures ?? null)
  }

  // THE AMAZON TITLE (migration 370), read on its own: before the SQL runs the
  // column does not exist, the box reads as empty, and saving says so.
  const amazonTitleById = new Map<string, string | null>()
  let amazonTitleAvailable = true
  {
    const { data: arows, error: aerr } = await sb.from('launch_items').select('id,amazon_title').eq('batch_id', id)
    if (aerr) amazonTitleAvailable = false
    else for (const r of (arows ?? []) as Array<{ id: string; amazon_title: string | null }>) amazonTitleById.set(r.id, r.amazon_title ?? null)
  }

  // THIS VIDEO'S OWN FACE (migration 371), read on its own for the same reason.
  const faceById = new Map<string, unknown>()
  let faceAvailable = true
  {
    const { data: frows, error: ferr } = await sb.from('launch_items').select('id,thumbnail_face').eq('batch_id', id)
    if (ferr) faceAvailable = false
    else for (const r of (frows ?? []) as Array<{ id: string; thumbnail_face: unknown }>) faceById.set(r.id, r.thumbnail_face ?? null)
  }

  const itemsOut = items.map((i) => ({
    amazon_title: amazonTitleById.get(i.id) ?? null,
    thumbnail_face: faceById.get(i.id) ?? null,
    api_disclosures: disclosuresById.get(i.id) ?? null,
    amazon: (i.video_id && amazonByVideo.get(i.video_id)) || [],
    ...i,
    playlist_added_at: extra.get(i.id)?.playlist_added_at ?? null,
    playlist_error: extra.get(i.id)?.playlist_error ?? null,
    studio_finish: readStudioRun(extra.get(i.id)?.studio_finish),
  }))

  // YOUTUBE OR AMAZON ONLY (migration 369), read on its own like the rest.
  const { batch: b, available: youtubeChoiceAvailable } = await withYouTubeChoice(sb, batch as BatchRow)
  return NextResponse.json({
    ok: true,
    batch: {
      ...b,
      markets: (b.markets ?? []).map((d) => ({
        domain: d,
        country: marketByDomain(d)?.country ?? d,
        langName: marketByDomain(d)?.langName ?? null,
        needsDub: !!marketByDomain(d)?.needsTranslation,
      })),
    },
    items: itemsOut,
    steps: batchSteps(b, items),
    // THE REASON, not just a boolean. A disabled Launch button with nothing
    // beside it is the dead end this codebase keeps producing.
    // THE SAME ANSWER THE LAUNCH ROUTE WILL GIVE, including the channel check
    // that needs a lookup. A page that enables the button while the route
    // refuses it is the bug this file already produced once.
    launchBlocker: await launchReadiness(sb, user.id, b, items),
    maxItems: MAX_ITEMS,
    // False until migration 364 is run. The page then shows why per-video
    // times are missing instead of an editor whose every save is refused.
    ownSchedules,
    notifySubscribers,
    // False until migration 366 is run: the toggle is shown off and locked,
    // with the reason, and the uploader treats the batch as No.
    notifyAvailable,
    playlistId: !yerr ? (yrow?.playlist_id ?? null) : null,
    studioOptions: normalizeStudioOptions(!yerr ? yrow?.studio_options : null),
    youtubeOptionsAvailable,
    youtubeChoiceAvailable,
    amazonTitleAvailable,
    faceAvailable,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    name?: string
    // `null` is a real answer: no CTA on any of them.
    cta?: Record<string, unknown> | null
    ctaChosen?: boolean
    // `null` is a real answer here too: the house look on all of them.
    thumbnail?: Record<string, unknown> | null
    thumbnailChosen?: boolean
    markets?: string[]
    dailySlots?: string[]
    startOn?: string | null
    timezone?: string
    /** Notify subscribers when each video goes public. */
    notifySubscribers?: boolean
    /** The playlist each video is added to. `null` means none. */
    playlistId?: string | null
    /** Which Studio steps SCOUT does on Finish in Studio. */
    studioOptions?: Record<string, unknown>
    /** False: Amazon only, nothing goes to YouTube. */
    sendToYouTube?: boolean
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  // What we refused to store, so the screen can say so. Saving anyway and
  // reporting the difference beats a 400 that loses every other change in the
  // same request.
  let thumbnailRejected: string[] = []
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 120) || 'Untitled batch'

  // THE DECISION IS SEPARATE FROM THE VALUE. "No CTA" and "not asked yet" are
  // both an empty cta column, and a batch would otherwise sit waiting for an
  // answer the creator had already given.
  if (body.ctaChosen !== undefined || body.cta !== undefined) {
    // `cta` left out means "unchanged", not "none": ctaChosen on its own used
    // to wipe the design. Only an explicit null clears it.
    if (body.cta === undefined) {
      /* the decision alone */
    } else if (body.cta) {
      // VALIDATED BEFORE IT IS STORED. This preset is replayed by a background
      // worker onto ten videos with nobody watching, so an arbitrary image URL
      // here would be a standing instruction to composite whatever it points
      // at. Only our own gallery or a badge we generated.
      const v = validateCtaPreset(body.cta, process.env.NEXT_PUBLIC_SUPABASE_URL)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      patch.cta = v.preset
    } else {
      patch.cta = null
    }
    patch.cta_chosen = body.ctaChosen ?? true
  }

  // THE SAME SHAPE AS THE CTA, for the same reason. A creator who opens the
  // thumbnail step, looks at the controls and keeps the house look has ANSWERED
  // it, and a batch that cannot tell that from silence waits forever.
  if (body.thumbnailChosen !== undefined || body.thumbnail !== undefined) {
    if (body.thumbnail === undefined) {
      /* the decision alone, the look unchanged */
    } else if (body.thumbnail) {
      // Never refuses, so one odd control cannot block the save. What it drops,
      // it names, and the answer goes back to the screen rather than being
      // applied silently to ten videos.
      const { preset, rejected } = validateThumbnailPreset(body.thumbnail, process.env.NEXT_PUBLIC_SUPABASE_URL)
      patch.thumbnail = preset
      if (rejected.length > 0) thumbnailRejected = rejected
    } else {
      patch.thumbnail = null
    }
    patch.thumbnail_chosen = body.thumbnailChosen ?? true
  }

  if (Array.isArray(body.markets)) {
    // Only storefronts MVP actually supports, so a typo cannot create a column
    // the pipeline has no idea what to do with.
    patch.markets = [...new Set(body.markets.filter((d) => !!marketByDomain(d)))]
  }
  if (Array.isArray(body.dailySlots)) {
    // Cleaned and sorted here as well as on screen, because the cadence is what
    // the schedule is built from and the order of the slots IS the order of the
    // day.
    patch.daily_slots = normalizeSlots(body.dailySlots)
  }
  if (body.startOn !== undefined) {
    const s = (body.startOn || '').trim()
    patch.start_on = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    const tz = body.timezone.trim()
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); patch.timezone = tz }
    catch { /* an unknown zone is ignored rather than stored, so the old one stands */ }
  }

  if (typeof body.notifySubscribers === 'boolean') patch.notify_subscribers = body.notifySubscribers
  if (body.playlistId !== undefined) {
    const pl = String(body.playlistId ?? '').trim()
    if (pl && !/^[A-Za-z0-9_-]{10,64}$/.test(pl)) return NextResponse.json({ error: 'That is not a YouTube playlist.' }, { status: 400 })
    patch.playlist_id = pl || null
  }
  if (body.studioOptions !== undefined) patch.studio_options = normalizeStudioOptions(body.studioOptions)
  if (typeof body.sendToYouTube === 'boolean') patch.send_to_youtube = body.sendToYouTube

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // AFTER LAUNCH THE TOGGLE IS LOCKED, for the same reason the times are:
  // the uploader may already have sent YouTube the old answer, and a switch
  // that changes on screen but not on the channel is the plan reported as
  // the result.
  // THE PLAYLIST IS NOT LOCKED. A playlist picked after launch still reaches
  // every video, including the ones already up (playlistCatchUp in the
  // uploader). Changing it once videos are in one adds the rest to the new one
  // and leaves the earlier ones where they are, and the rows say which.
  if (patch.notify_subscribers !== undefined || patch.send_to_youtube !== undefined) {
    const { data: cur } = await sb.from('launch_batches')
      .select('state').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (cur && (cur.state === 'launching' || cur.state === 'launched')) {
      return NextResponse.json({
        error: patch.send_to_youtube !== undefined
          ? 'This batch has already been launched, so where it goes is locked in.'
          : 'This batch has already been launched, so its notification setting is locked in. You can change it per video in YouTube Studio.',
      }, { status: 409 })
    }
  }

  // What the CTA and the look were before this save, to know whether the
  // videos already built from them need building again (below).
  const { data: before } = (patch.cta !== undefined || patch.thumbnail !== undefined)
    ? await sb.from('launch_batches').select('cta,thumbnail,state').eq('id', id).eq('user_id', user.id).maybeSingle()
    : { data: null }

  const { error } = await sb.from('launch_batches')
    .update(patch).eq('id', id).eq('user_id', user.id)
  if (error) {
    // THE ONE ERROR WITH A KNOWN CAUSE, said in words: before migration 366
    // the column does not exist, and nothing else in this request was saved.
    if (patch.send_to_youtube !== undefined && /send_to_youtube/.test(error.message)) {
      return NextResponse.json({
        error: 'Amazon only is not switched on yet: the database needs migration 369. Nothing was saved; this batch goes to YouTube and Amazon.',
      }, { status: 503 })
    }
    if ((patch.playlist_id !== undefined || patch.studio_options !== undefined) && /playlist_id|studio_options/.test(error.message)) {
      return NextResponse.json({
        error: 'The YouTube options are not switched on yet: the database needs migration 367. Nothing was saved.',
      }, { status: 503 })
    }
    if (patch.notify_subscribers !== undefined && /notify_subscribers/.test(error.message)) {
      return NextResponse.json({
        error: 'The notify toggle is not switched on yet: the database needs migration 366. Nothing was saved. Until then, batch videos do not notify subscribers.',
      }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── A NEW CTA OR LOOK REBUILDS WHAT WAS BUILT FROM THE OLD ONE ───────────
  //
  // The CTA is burned in and the thumbnails generated once, when each video
  // is prepared. Changing either afterwards used to change only the setting:
  // the videos already built kept the old design while the step said "It goes
  // on all of them". Now every video not yet handed to the uploader is sent
  // back to be built again with the new one. Videos queued or on YouTube are
  // left alone, and the answer says how many were rebuilt.
  let rebuilt = 0
  if (before && before.state !== 'launching' && before.state !== 'launched') {
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    const ctaChanged = patch.cta !== undefined && !same(before.cta, patch.cta)
    const lookChanged = patch.thumbnail !== undefined && !same(before.thumbnail, patch.thumbnail)
    if (ctaChanged || lookChanged) {
      const { data: built } = await sb.from('launch_items')
        .select('id,state,rendered_url,thumbnail_url,thumbnail_clean_url')
        .eq('batch_id', id).eq('user_id', user.id)
        // RENDERING TOO: a video being burned in right now has already read
        // the old CTA. Sent back to draft here, and the worker's write only
        // lands on the render it claimed, so the old one is thrown away.
        .in('state', ['rendering', 'preparing', 'prepared', 'blocked'])
        .is('youtube_video_id', null).is('planned_publish_at', null)
      for (const it of (built ?? []) as Array<{ id: string; state?: string; rendered_url: string | null; thumbnail_url: string | null; thumbnail_clean_url: string | null }>) {
        const redo: Record<string, unknown> = { reason: null, updated_at: new Date().toISOString() }
        if (ctaChanged && (it.rendered_url || it.state === 'rendering')) {
          Object.assign(redo, { state: 'draft', rendered_url: null, render_tries: 0 })
        } else if (lookChanged && (it.thumbnail_url || it.thumbnail_clean_url)) {
          Object.assign(redo, { state: 'preparing', thumbnail_url: null, thumbnail_clean_url: null, thumbnail_source: null, thumb_tries: 0 })
        } else continue
        if (lookChanged) Object.assign(redo, { thumbnail_url: null, thumbnail_clean_url: null, thumbnail_source: null, thumb_tries: 0 })
        const { error: rErr } = await sb.from('launch_items').update(redo).eq('id', it.id).eq('user_id', user.id)
        if (!rErr) rebuilt++
      }
    }
  }
  return NextResponse.json({ ok: true, rejected: thumbnailRejected, rebuilt })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // `?confirm=1`, which a launched batch needs and a draft does not.
  const confirmed = new URL(req.url).searchParams.get('confirm') === '1'
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches')
    .select('state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  // ── A LAUNCHED BATCH CAN BE CLEARED AWAY, WITH THE TRUTH SAID FIRST ──────
  //
  // It used to be refused outright, on the grounds that deleting the row does
  // not unschedule anything. That reasoning is right and the conclusion was
  // wrong: the result was a list of finished batches nobody could tidy, and a
  // page that fills up with rows you cannot act on teaches people to ignore it.
  //
  // So it is allowed, and the caller must say it meant it. The videos stay on
  // YouTube and the storefront listings stay up; what goes is MVP's record of
  // the batch. The screen says exactly that before the confirm, because this is
  // the one place somebody could reasonably expect a delete to take something
  // down.
  const launched = batch.state === 'launched' || batch.state === 'launching'
  if (launched && !confirmed) {
    return NextResponse.json({
      needsConfirm: true,
      error: 'This batch has already gone out. Deleting it here removes MVP\u2019s record of it and leaves the videos on YouTube and the listings on Amazon exactly where they are.',
    }, { status: 409 })
  }

  // NOT WHILE THE UPLOADER STILL HAS ANY OF IT. Deleting the batch deletes
  // its videos' rows, so a video queued for YouTube was silently cancelled
  // (the opposite of what the confirm says), and one mid-upload still reached
  // the channel with no record left here to show it.
  if (launched) {
    const { data: queued, error: qErr } = await sb.from('launch_items').select('id')
      .eq('batch_id', id).eq('user_id', user.id).eq('state', 'prepared').not('planned_publish_at', 'is', null)
    if (qErr) return NextResponse.json({ error: `Could not check this batch's uploads: ${qErr.message}` }, { status: 500 })
    if ((queued ?? []).length > 0) {
      const n = (queued ?? []).length
      return NextResponse.json({
        error: `${n} ${n === 1 ? 'video is' : 'videos are'} still on the way to YouTube. Delete this batch once ${n === 1 ? 'it is' : 'they are'} on YouTube, or it would cancel ${n === 1 ? 'it' : 'them'} part way.`,
      }, { status: 409 })
    }
  }

  const { error } = await sb.from('launch_batches').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
