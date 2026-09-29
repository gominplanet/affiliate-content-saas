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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'instagram-videos'
/** The same ceiling as a hand upload. */
const MAX_BYTES = 300 * 1024 * 1024

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
  const { data: pub } = createAdminClient().storage.from(BUCKET).getPublicUrl(path)
  // What arrived, not what was meant to.
  const head = await fetch(pub.publicUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  const size = Number(head?.headers.get('content-length') || 0)
  if (!head?.ok || !size) return NextResponse.json({ error: 'The file did not arrive in MVP storage, so nothing was attached.' }, { status: 422 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (o.supabase as any).from('youtube_videos')
    .update({ source_video_url: pub.publicUrl, source_video_uploaded_at: new Date().toISOString() })
    .eq('id', o.video.id).eq('user_id', o.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, bytes: size })
}
