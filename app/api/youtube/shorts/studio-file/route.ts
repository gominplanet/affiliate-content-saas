// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/youtube/shorts/studio-file — the creator's own video file, brought in
// by SCOUT from YouTube Studio (MVP_STUDIO_VIDEO_FILE), so Clip Factory never
// has to download from YouTube on MVP's server.
//
// POST { videoId }            a one-time upload address for this video's file
// PUT  { videoId, path }      after SCOUT uploaded: attach it as the source
//
// The file lives with the other Clip Factory sources (source-*, cleared after
// a day by purge-shorts-sources), in the creator's own folder.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SOURCE_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'instagram-videos'
/** The same ceiling as a hand upload of a clip source (lib/clip-source-limits). */
const MAX_BYTES = SOURCE_VIDEO_MAX_BYTES

async function owned(videoId: string) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: video } = await (supabase as any).from('youtube_videos').select('id,youtube_video_id')
    .eq('id', videoId).eq('user_id', user.id).maybeSingle()
  if (!video) return { error: NextResponse.json({ error: 'Video not found.' }, { status: 404 }) }
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(video.youtube_video_id || ''))) {
    return { error: NextResponse.json({ error: 'This video is not on YouTube, so there is nothing to fetch from Studio.' }, { status: 400 }) }
  }
  return { supabase, user, video }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { videoId?: string }
  const o = await owned(String(body.videoId || ''))
  if ('error' in o) return o.error
  const path = `${o.user.id}/source-${crypto.randomUUID()}.mp4`
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) return NextResponse.json({ error: `MVP could not open an upload for the file: ${error?.message || 'no address'}` }, { status: 500 })
  return NextResponse.json({ ok: true, uploadUrl: data.signedUrl, path, youtubeVideoId: o.video.youtube_video_id, maxBytes: MAX_BYTES })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({})) as { videoId?: string; path?: string }
  const o = await owned(String(body.videoId || ''))
  if ('error' in o) return o.error
  const path = String(body.path || '')
  // Only a file in this creator's own folder, of the name this route issued.
  if (!new RegExp(`^${o.user.id}/source-[0-9a-f-]{36}\\.mp4$`).test(path)) return NextResponse.json({ error: 'That is not the upload MVP issued.' }, { status: 400 })
  const admin = createAdminClient()
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  // WHAT ARRIVED, NOT WHAT WAS MEANT TO, asked of storage itself. A HEAD on the
  // public address alone said "did not arrive" for a file that had (a large
  // one the address was still catching up on, 2026-10-06), so storage's own
  // record is read first and the address is asked a few times after it.
  const folder = path.split('/')[0], name = path.split('/')[1]
  let size = 0
  try {
    const { data: listed } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 1 })
    const hit = (listed || []).find((f) => f.name === name) as { metadata?: { size?: number } } | undefined
    size = Number(hit?.metadata?.size || 0)
  } catch { /* the address is asked below */ }
  for (let i = 0; !size && i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 2000))
    const head = await fetch(pub.publicUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
    if (head?.ok) size = Number(head.headers.get('content-length') || 0) || -1
  }
  if (!size) return NextResponse.json({ error: 'SCOUT sent the file, but MVP storage does not have it, so nothing was attached. Drop the file in the box instead.' }, { status: 422 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (o.supabase as any).from('youtube_videos')
    .update({ source_video_url: pub.publicUrl, source_video_uploaded_at: new Date().toISOString() })
    .eq('id', o.video.id).eq('user_id', o.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, bytes: size > 0 ? size : null })
}
