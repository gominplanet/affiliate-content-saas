// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PATCH  /api/launch/items/[id] — the one video's own product, copy and
//                                 YouTube date and time.
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
    .select('id,state,batch_id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: body.schedule !== undefined
        ? 'This one is already on YouTube, so its time is set there now. Change it in YouTube Studio.'
        : 'This one is already on YouTube, so its title and product are set there now.',
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

    // AFTER LAUNCH, THE TIME IS ALREADY WRITTEN. The launch route copies each
    // video's time onto planned_publish_at, and that is what the uploader
    // gives YouTube. Accepting a change now would show the new time on the
    // screen while YouTube got the old one, which is the plan reported as the
    // result. So it is refused, and the message says why.
    if (batch.state === 'launching' || batch.state === 'launched') {
      return NextResponse.json({
        error: 'This batch has already been launched, so this video\'s time is locked in. Once it is on YouTube you can change it in YouTube Studio.',
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

  // A video that was blocked for a missing product is no longer blocked once it
  // has one. Left alone, it would sit in the way of a launch it could join.
  if (patch.asin && item.state === 'blocked') {
    patch.state = 'draft'
    patch.reason = null
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
    .select('id,batch_id,position,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  if (item.state === 'scheduled' || item.state === 'published') {
    return NextResponse.json({
      error: 'This one is already on YouTube. Removing it here would not take it down.',
    }, { status: 409 })
  }

  const { error } = await sb.from('launch_items').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // CLOSE THE GAP. Position drives the publishing order, and a hole in it would
  // leave the cadence with an empty slot in the middle of the run.
  const { data: rest } = await sb.from('launch_items')
    .select('id,position').eq('batch_id', item.batch_id).order('position', { ascending: true })
  let i = 0
  for (const r of (rest ?? [])) {
    if (r.position !== i) await sb.from('launch_items').update({ position: i }).eq('id', r.id)
    i++
  }
  return NextResponse.json({ ok: true })
}
