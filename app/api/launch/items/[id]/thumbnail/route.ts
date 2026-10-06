// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST   /api/launch/items/[id]/thumbnail  the creator's own thumbnail for this
//                                          Liftoff video (multipart, field "file").
// DELETE /api/launch/items/[id]/thumbnail  back to the one MVP builds.
//
// THEIR OWN, KEPT. A thumbnail the creator brought is marked 'creator', and
// nothing MVP does afterwards (a new look for the batch, a new face, a new
// product) builds over it. It goes to YouTube and to Amazon as given.
//
// Checked here, not on YouTube: a JPEG or PNG at least 640 wide, and sent on
// as a JPEG under YouTube's 2MB limit, so an upload that would be refused at
// publish time is refused now, while the creator is looking.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_IN = 4.4 * 1024 * 1024
const YT_MAX = 2 * 1024 * 1024
const BUCKET = 'instagram-videos'

async function owned(id: string) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const { data: item } = await sb.from('launch_items')
    .select('id,user_id,state,youtube_video_id,thumbnail_source').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!item) return { error: NextResponse.json({ error: 'Video not found.' }, { status: 404 }) }
  // ON YOUTUBE ALREADY: its thumbnail is YouTube's now, changed in Studio.
  if (String(item.youtube_video_id || '').trim()) {
    return { error: NextResponse.json({ error: 'This video is already on YouTube, so change its thumbnail in YouTube Studio.' }, { status: 409 }) }
  }
  return { user, sb, item }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await owned(id)
  if ('error' in o) return o.error
  const { user, sb, item } = o
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 })
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return NextResponse.json({ error: 'Use a JPG or PNG image.' }, { status: 400 })
  if (file.size > MAX_IN) return NextResponse.json({ error: 'That image is over 4MB. Use a smaller one.' }, { status: 400 })

  let out: Buffer
  let width = 0, height = 0
  try {
    const sharp = (await import('sharp')).default
    const input = Buffer.from(await file.arrayBuffer())
    const meta = await sharp(input).metadata()
    width = meta.width ?? 0; height = meta.height ?? 0
    if (width < 640) return NextResponse.json({ error: `That image is ${width} pixels wide. YouTube needs at least 640 (1280 by 720 is best).` }, { status: 400 })
    // A JPEG under YouTube's 2MB, at the most 1920 wide, as close to the
    // original as that allows.
    const base = sharp(input).rotate().resize({ width: Math.min(width, 1920), withoutEnlargement: true })
    out = await base.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    for (const q of [82, 74, 66, 58]) {
      if (out.byteLength <= YT_MAX) break
      out = await base.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer()
    }
    if (out.byteLength > YT_MAX) return NextResponse.json({ error: 'That image could not be brought under YouTube’s 2MB limit. Use a simpler or smaller one.' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'That file could not be read as an image.' }, { status: 400 })
  }

  const path = `${user.id}/liftoff-thumb-${id}-${Date.now()}.jpg`
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, out, { contentType: 'image/jpeg', upsert: false })
  if (upErr) return NextResponse.json({ error: `The image could not be stored: ${upErr.message}` }, { status: 500 })
  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  // The same image for YouTube and Amazon. A video already prepared stays
  // prepared; one still preparing goes on as soon as its description is in.
  const { data: kept, error } = await sb.from('launch_items').update({
    thumbnail_url: url, thumbnail_clean_url: url, thumbnail_source: 'creator', thumb_tries: 0,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('user_id', user.id).is('youtube_video_id', null).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kept || kept.length === 0) return NextResponse.json({ error: 'This video went to YouTube while the image was uploading, so its thumbnail is YouTube’s now. Change it in Studio.' }, { status: 409 })
  return NextResponse.json({ ok: true, url, width, height })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await owned(id)
  if ('error' in o) return o.error
  const { user, sb, item } = o
  if (item.thumbnail_source !== 'creator') return NextResponse.json({ ok: true })
  // Back to MVP's: cleared, and built again by the next prepare run.
  const { error } = await sb.from('launch_items').update({
    thumbnail_url: null, thumbnail_clean_url: null, thumbnail_source: null, thumb_tries: 0,
    ...(item.state === 'prepared' ? { state: 'preparing', reason: null } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('user_id', user.id).is('youtube_video_id', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
