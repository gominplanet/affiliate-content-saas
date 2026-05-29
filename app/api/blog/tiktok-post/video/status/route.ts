/**
 * GET /api/blog/tiktok-post/video/status?videoId=… — poll terminal state
 * for a direct-video TikTok publish (no blog post involved).
 *
 * Mirrors /api/blog/tiktok-post/status but reads/writes youtube_videos.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidTikTokToken, pollPublishStatus } from '@/services/tiktok'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const videoId = (searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb
    .from('youtube_videos')
    .select('tiktok_publish_id,tiktok_publish_status,tiktok_share_url,tiktok_error_message')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video?.tiktok_publish_id) {
    return NextResponse.json({ error: 'No TikTok publish in progress for this video.' }, { status: 404 })
  }

  // Short-circuit on terminal states — no fresh TikTok poll needed.
  if (video.tiktok_publish_status === 'published' || video.tiktok_publish_status === 'failed') {
    return NextResponse.json({
      status: video.tiktok_publish_status,
      shareUrl: video.tiktok_share_url ?? null,
      errorMessage: video.tiktok_error_message ?? null,
    })
  }

  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({
      error: 'TikTok token expired. Reconnect TikTok.',
      reconnectRequired: true,
    }, { status: 412 })
  }

  const result = await pollPublishStatus(token, video.tiktok_publish_id)

  if (result.status === 'PUBLISH_COMPLETE') {
    await sb
      .from('youtube_videos')
      .update({
        tiktok_publish_status: 'published',
        tiktok_share_url: result.publicShareUrl,
      })
      .eq('id', videoId)
      .eq('user_id', user.id)
    return NextResponse.json({ status: 'published', shareUrl: result.publicShareUrl, errorMessage: null })
  }
  if (result.status === 'FAILED') {
    await sb
      .from('youtube_videos')
      .update({
        tiktok_publish_status: 'failed',
        tiktok_error_message: result.failureReason ?? 'TikTok rejected the publish.',
      })
      .eq('id', videoId)
      .eq('user_id', user.id)
    return NextResponse.json({ status: 'failed', shareUrl: null, errorMessage: result.failureReason })
  }

  return NextResponse.json({
    status: 'processing',
    rawStatus: result.rawStatus,
    shareUrl: null,
    errorMessage: null,
  })
}
