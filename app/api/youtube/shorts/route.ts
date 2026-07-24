/**
 * GET /api/youtube/shorts?videoId=<uuid>
 *
 * List the Shorts Studio clips (suggested + rendered) for one long-form video,
 * newest-scoring first, so the modal can restore state on reopen. Also returns
 * whether the source MP4 has been uploaded yet (drives the upload prompt).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { rowToShort } from '@/lib/shorts-row'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const videoId = (new URL(request.url).searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb.from('youtube_videos')
    .select('id,source_video_url')
    .eq('id', videoId).eq('user_id', user.id).maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const { data: rows, error } = await sb.from('youtube_shorts')
    .select('*')
    .eq('user_id', user.id).eq('video_id', videoId)
    .order('score', { ascending: false })
    .order('start_sec', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shorts: ((rows ?? []) as any[]).map(rowToShort),
    hasSource: !!(video.source_video_url as string | null),
  })
}
