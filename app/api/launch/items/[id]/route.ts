// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PATCH  /api/launch/items/[id] — the one video's own product, copy and
//                                 YouTube date and time; or, on its own, what
//                                 SCOUT's last Studio run reported.
// DELETE /api/launch/items/[id] — take it out of the batch.
//
// EVERY VIDEO IS ITS OWN VIDEO. The CTA and the countries are shared; the
// product, the title and the description are not, and treating a batch as ten
// variants of one thing is the mistake this endpoint exists to prevent.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeAsinInput, asinFromAmazonUrl } from '@/lib/asin'
import { resolveAsinFromLinks } from '@/lib/product-link'
import { normalizeSlots, todayIn } from '@/lib/launch-schedule'
import { readStudioRun } from '@/lib/studio-finish'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    /** An ASIN, or an Amazon link, or a shortener that ends at one. */
    product?: string
    title?: string
    description?: string
    /** This video's own YouTube date and time, in the batch's zone. Null puts
     *  it back on the batch pattern. Absent leaves it as it is. */
    schedule?: { date: string; time: string } | null
    /** SCOUT's Studio run on this video, as lib/studio-finish stores it. Sent
     *  on its own, and accepted whatever state the video is in: the run
     *  happens after it is on YouTube. */
    studioFinish?: unknown
  }

  // ── WHAT SCOUT REPORTED, AND NOTHING ELSE ─────────────────────────────────
  // Recorded so the board shows each video's Studio steps after a reload, as
  // Studio read them back. Only a well-formed run is stored, and only this
  // column is touched: the rules below guard a video's copy and time, and a
  // report about the video is neither.
  if (body.studioFinish !== undefined) {
    const run = readStudioRun(body.studioFinish)
    if (!run) return NextResponse.json({ error: 'That is not a Studio run.' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('launch_items')
      .update({ studio_finish: run }).eq('id', id).eq('user_id', user.id)
    if (error) {
      if (/studio_finish/.test(error.message)) {
        return NextResponse.json({
          error: 'SCOUT finished, but its report could not be kept: the database needs migration 367. The result is shown until you reload.',
        }, { status: 503 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string') {
    patch.title = body.title.trim().slice(0, 200) || null
    // THEIRS NOW, AND NEVER OVERWRITTEN. The worker writes a title from the
    // product for any video still carrying its file name; without this line it
    // could not tell that one apart from a title somebody meant.
    patch.title_source = 'creator'
  }
  if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 5000) || null

  // ── THE PRODUCT, FROM WHATEVER THEY PASTED ────────────────────────────────
  //
  // A bare ASIN, a full Amazon URL, or a shortened link. The last one is why
  // this follows redirects rather than matching a list of hosts: a creator on
  // their own branded Geniuslink domain was reported as having no product at
  // all, because their domain was not on the list somebody had typed out.
  let productNote: string | null = null
  if (typeof body.product === 'string') {
    const raw = body.product.trim()
    if (!raw) {
      patch.asin = null
    } else {
      let asin = normalizeAsinInput(raw) || asinFromAmazonUrl(raw)
      if (!asin && /^https?:\/\//i.test(raw)) {
        try {
          const hit = await resolveAsinFromLinks(raw, null, 3)
          asin = hit?.asin ?? null
        } catch {
          // COULD NOT LOOK is not the same as no product. Said, so the creator
          // can paste the ASIN itself rather than wonder why their link vanished.
          return NextResponse.json({
            error: 'Could not follow that link just now. Paste the ASIN itself, or try again.',
          }, { status: 502 })
        }
      }
      if (!asin) {
        return NextResponse.json({
          error: 'That is not an Amazon product. Paste the 10-character ASIN or the product link.',
        }, { status: 400 })
      }
      patch.asin = asin
      if (asin !== raw.toUpperCase()) productNote = asin
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,state,batch_id,reason,rendered_url,title_source,youtube_video_id,planned_publish_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  const onYouTube = !!String(item.youtube_video_id || '').trim()
  // A video kept private after a missed slot: on the channel, with no time.
  // Its time is the one thing it needs, and the one thing it could not get.
  const keptPrivate = item.state === 'blocked' && onYouTube && /^Kept private\./.test(String(item.reason || ''))
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: body.schedule !== undefined
        ? 'This one is already on YouTube, so its time is set there now. Change it in YouTube Studio.'
        : 'This one is already on YouTube, so its title and product are set there now.',
    }, { status: 409 })
  }
  // ON YOUTUBE ALREADY, whatever its state says: its words and product are
  // set there. Only checking 'scheduled' and 'published' let a blocked video
  // that was already on the channel be sent back for a full re-render.
  if (onYouTube && (typeof body.product === 'string' || typeof body.title === 'string' || typeof body.description === 'string')) {
    return NextResponse.json({
      error: 'This one is already on your YouTube channel, so its title, description and product are set there now. Change them in YouTube Studio.',
    }, { status: 409 })
  }
  // QUEUED FOR UPLOAD: the product is locked, because the thumbnails and the
  // description the uploader is about to send were made from the old one.
  if (item.planned_publish_at && typeof body.product === 'string') {
    return NextResponse.json({
      error: 'This one is already queued for YouTube, so its product is locked in. Its title and description can still be changed until it uploads.',
    }, { status: 409 })
  }

  // ── ITS OWN DATE AND TIME ─────────────────────────────────────────────────
  //
  // Validated here, against the batch's own zone, rather than trusted from
  // the page: the constraint in migration 364 guarantees the SHAPE, and only
  // this code can say whether the day has already gone where the creator is.
  if (body.schedule !== undefined) {
    const { data: batch } = await sb.from('launch_batches')
      .select('timezone,state').eq('id', item.batch_id).eq('user_id', user.id).maybeSingle()
    if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

    // ONCE THE UPLOADER HAS THE TIME, IT IS LOCKED. The launch route copies
    // each video's time onto planned_publish_at, and that is what the
    // uploader gives YouTube; a change now would show one time on screen while
    // YouTube got another. Per VIDEO, not per batch: a video left behind at
    // launch and fixed since, or one kept private after a missed slot, has no
    // time the uploader holds, and a new one is exactly what it needs.
    if (item.planned_publish_at && !keptPrivate) {
      return NextResponse.json({
        error: 'This video is already queued for YouTube, so its time is locked in. Once it is on YouTube you can change it in YouTube Studio.',
      }, { status: 409 })
    }

    if (body.schedule === null) {
      patch.custom_publish_date = null
      patch.custom_publish_time = null
    } else {
      const date = String(body.schedule?.date ?? '').trim()
      const time = normalizeSlots([String(body.schedule?.time ?? '')])[0]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) {
        return NextResponse.json({ error: 'Pick both a date and a time for this video.' }, { status: 400 })
      }
      // A REAL DAY, not only the right shape. 2026-02-30 used to be stored
      // and quietly scheduled for 2 March.
      const [yy, mm, dd] = date.split('-').map(Number)
      const probe = new Date(Date.UTC(yy, mm - 1, dd))
      if (probe.getUTCFullYear() !== yy || probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) {
        return NextResponse.json({ error: `${date} is not a real day. Pick one from the calendar.` }, { status: 400 })
      }
      const tz = batch.timezone || 'UTC'
      if (date < todayIn(tz)) {
        return NextResponse.json({
          error: 'That day has already been and gone. Pick today to send it out as soon as it uploads, or a day ahead.',
        }, { status: 400 })
      }
      patch.custom_publish_date = date
      patch.custom_publish_time = time
    }
  }

  // A KEPT-PRIVATE VIDEO WITH A NEW TIME is ready to go again: back to
  // prepared with no upload time, so "Launch these too" hands it to the
  // uploader, which sees its YouTube id and only sets the time.
  if (keptPrivate && body.schedule) {
    patch.state = 'prepared'
    patch.planned_publish_at = null
    patch.publish_tries = 0
    patch.reason = null
  }

  // ── A NEW PRODUCT MEANS NEW THUMBNAILS AND A NEW DESCRIPTION ─────────────
  //
  // Changing the product used to change only the ASIN on a video that was
  // already ready, so it launched with thumbnails of the old product and a
  // description whose affiliate link sold something else. Now everything made
  // from the product is cleared and made again; the CTA render is kept, since
  // it does not depend on the product. A title MVP wrote goes back to being
  // rewritten; one the creator typed is left alone. (A blocked video with no
  // render goes back to the start, as it always did.)
  if (patch.asin && patch.asin !== undefined) {
    const { data: cur } = await sb.from('launch_items').select('asin').eq('id', id).maybeSingle()
    const changed = String(cur?.asin || '').toUpperCase() !== String(patch.asin).toUpperCase()
    if (changed || item.state === 'blocked') {
      patch.state = item.rendered_url ? 'preparing' : 'draft'
      patch.reason = null
      patch.thumbnail_url = null
      patch.thumbnail_clean_url = null
      patch.thumbnail_source = null
      patch.thumb_tries = 0
      if (typeof body.description !== 'string') patch.description = null
      if (item.title_source === 'mvp' && typeof body.title !== 'string') patch.title_source = 'filename'
    }
  }

  const { error } = await sb.from('launch_items').update(patch).eq('id', id).eq('user_id', user.id)
  if (error) {
    // THE ONE ERROR WITH A KNOWN CAUSE. If migration 364 has not been run the
    // columns do not exist, and PostgREST's own sentence about a schema cache
    // means nothing to the person who just picked a time.
    if (body.schedule !== undefined && /custom_publish_(date|time)/.test(error.message)) {
      return NextResponse.json({
        error: 'Per-video times are not switched on yet: the database needs migration 364. Nothing was saved.',
      }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, asin: patch.asin ?? null, resolvedFromLink: productNote })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.from('launch_items')
    .select('id,batch_id,position,state,youtube_video_id,planned_publish_at').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  // ON THE CHANNEL OR ON ITS WAY THERE, whatever the state says. Only checking
  // 'scheduled' and 'published' let a video mid-upload, or one kept private,
  // be deleted here while it stayed on YouTube with no record left in MVP.
  if (String(item.youtube_video_id || '').trim()) {
    return NextResponse.json({
      error: 'This one is already on your YouTube channel. Removing it here would not take it down, and MVP would lose track of it.',
    }, { status: 409 })
  }
  if (item.planned_publish_at && item.state === 'prepared') {
    return NextResponse.json({
      error: 'This one is queued for YouTube and may be uploading right now, so it cannot be removed here.',
    }, { status: 409 })
  }
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube. Removing it here would not take it down.',
    }, { status: 409 })
  }
  // AMAZON ONLY, HANDED OVER: its listings are on their way (or up) with no
  // YouTube id to show for it, so the checks above never caught it.
  if (item.state === 'amazon_only') {
    return NextResponse.json({
      error: 'This one has already gone to the Amazon side. Removing it here would not take its listings down, and MVP would lose track of them.',
    }, { status: 409 })
  }

  const { data: owner } = await sb.from('launch_batches').select('state').eq('id', item.batch_id).maybeSingle()
  const batchLaunched = owner?.state === 'launching' || owner?.state === 'launched'

  const { error } = await sb.from('launch_items').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // CLOSE THE GAP. Position drives the publishing order, and a hole in it would
  // leave the cadence with an empty slot in the middle of the run.
  // NOT ONCE LAUNCHED: the videos already queued have their times, and moving
  // everyone up a place handed a later latecomer the slot a queued video
  // already had, so two went out in the same minute.
  if (batchLaunched) return NextResponse.json({ ok: true })
  const { data: rest } = await sb.from('launch_items')
    .select('id,position').eq('batch_id', item.batch_id).order('position', { ascending: true })
  let i = 0
  for (const r of (rest ?? [])) {
    if (r.position !== i) await sb.from('launch_items').update({ position: i }).eq('id', r.id)
    i++
  }
  return NextResponse.json({ ok: true })
}
