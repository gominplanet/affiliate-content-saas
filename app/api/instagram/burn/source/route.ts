/**
 * GET /api/instagram/burn/source?videoId=<uuid>
 *
 * Lightweight lookup for the Shop Burner: given a youtube_videos row id,
 * return the already-stored vertical MP4 URL (instagram_video_url) so the
 * burner can load the clip directly instead of making the user re-upload.
 *
 * Deliberately cheap — unlike /api/instagram/post-direct-video/video-meta
 * this does NOT run AI caption generation. We only need the source URL (the
 * burner writes its own caption from the product). When no MP4 is stored
 * yet, returns { noVideo:true } + the YouTube id so the UI can link the
 * creator out to download the Short from YouTube and upload it once.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const videoId = (new URL(request.url).searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb
    .from('youtube_videos')
    .select('instagram_video_url,youtube_video_id,title')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

  const videoUrl = (video.instagram_video_url as string | null) ?? null
  return NextResponse.json({
    videoUrl,
    youtubeVideoId: video.youtube_video_id ?? null,
    title: (video.title as string) ?? '',
    noVideo: !videoUrl,
  })
}
