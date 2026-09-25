// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/batches/[id]/items — add an uploaded video to the batch.
//
// The upload itself happens in the creator's browser, because that is where
// the file is. What arrives here is the hosted URL it landed on, and the video
// joins the batch in 'draft' for the worker to pick up: burn the CTA, build the
// thumbnail, resolve the product.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { MAX_ITEMS } from '@/lib/launch-batch'
import { asinInFileName } from '@/lib/asin'
import { parseFacePick } from '@/lib/thumbnail-preset'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    sourceUrl?: string
    title?: string
    /** 'filename' (the default) or 'creator'. */
    titleSource?: string
    durationSeconds?: number
    /** Who is in this video, answered while it uploaded (migration 371). */
    thumbnailFace?: unknown
  }
  const sourceUrl = (body.sourceUrl || '').trim()
  if (!/^https:\/\//i.test(sourceUrl)) {
    return NextResponse.json({ error: 'A hosted video URL is required.' }, { status: 400 })
  }
  // OUR OWN STORAGE ONLY. The background worker downloads this file with
  // nobody watching and sends it to YouTube, so any https address used to be a
  // standing instruction to fetch whatever it pointed at. The page uploads to
  // this project's storage first; the CTA image is held to the same rule.
  const own = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host } catch { return '' }
  })()
  let host = ''
  try { host = new URL(sourceUrl).host } catch { /* not a URL */ }
  if (!own || host !== own || !new URL(sourceUrl).pathname.startsWith('/storage/v1/object/public/')) {
    return NextResponse.json({ error: 'Videos have to be uploaded through this page.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches')
    .select('id,state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (batch.state === 'launched' || batch.state === 'launching') {
    return NextResponse.json({
      error: 'This batch has already been launched. Start a new one for more videos.',
    }, { status: 409 })
  }

  // COUNTED IN POSTGRES. The cap is the promise on the page, and counting a
  // fetched array is how this codebase has produced a wrong total three times.
  const { count } = await sb.from('launch_items')
    .select('id', { count: 'exact', head: true }).eq('batch_id', id)
  const n = count ?? 0
  if (n >= MAX_ITEMS) {
    return NextResponse.json({
      error: `A batch holds ${MAX_ITEMS} videos. Launch this one, or start another.`,
    }, { status: 409 })
  }

  const { data, error } = await sb.from('launch_items').insert({
    batch_id: id,
    user_id: user.id,
    // Appended, so the order on screen is the order they were added and
    // therefore the order they publish in.
    position: n,
    source_url: sourceUrl,
    // The clean copy is the upload itself until a CTA is burned in, which is
    // also exactly what Amazon should receive: no CTA over a storefront video.
    clean_url: sourceUrl,
    duration_seconds: Number.isFinite(body.durationSeconds) ? Math.round(Number(body.durationSeconds)) : null,
    title: (body.title || '').trim().slice(0, 200) || null,
    // WHERE IT CAME FROM, recorded at the moment it is written. The page seeds
    // this from the uploaded file name, which is a placeholder and not a title
    // anybody chose, and without this column nothing downstream could tell it
    // apart from one somebody typed. A file name reached YouTube that way.
    title_source: body.titleSource === 'creator' ? 'creator' : 'filename',
    // THE PRODUCT IS OFTEN IN THE FILE NAME ("Ninja Crispi - B0DDDD8WD6").
    // Left unread, the video sat in the list as "Building the thumbnail" while
    // the worker was in fact waiting for a product it had been handed.
    asin: asinInFileName(body.title),
    state: 'draft',
  }).select('id,position').single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Could not add that video.' }, { status: 500 })
  }

  // WHO IS IN IT, asked beside the upload bar so it is answered before the
  // thumbnail is built. Its own write: a database without migration 371 adds
  // the video anyway, with the batch's face, and says so.
  let faceSaved: boolean | null = null
  const face = body.thumbnailFace == null ? null : parseFacePick(body.thumbnailFace)
  // A pick that is not a face MVP recognises is a pick that was not saved.
  if (body.thumbnailFace != null && !face) faceSaved = false
  if (face) {
    let ok = true
    if (face.kind === 'face') {
      const { data: mine } = await sb.from('face_models').select('id').eq('id', face.faceId).eq('user_id', user.id).maybeSingle()
      ok = !!mine
    }
    if (ok) {
      const { error: fErr } = await sb.from('launch_items').update({ thumbnail_face: face }).eq('id', data.id).eq('user_id', user.id)
      faceSaved = !fErr
    } else faceSaved = false
  }
  return NextResponse.json({ ok: true, id: data.id, position: data.position, videos: n + 1, faceSaved })
}
