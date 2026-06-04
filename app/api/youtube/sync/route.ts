import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeService } from '@/services/youtube'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YouTube API key not configured on the server. Contact support.', code: 'no_api_key' }, { status: 400 })
  }

  // Read per-user channel ID from integrations table. Use maybeSingle so a
  // missing integrations row (rare but possible right after signup) doesn't
  // throw the silent .single() error that the empty-catch on the client
  // then swallows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('youtube_channel_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const channelId = intRow?.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID
  if (!channelId) {
    return NextResponse.json({
      error: 'No YouTube channel ID set on your account yet. Open Blog Set Up → Integrations and paste your YouTube channel ID, then try Sync again.',
      code: 'no_channel_id',
    }, { status: 400 })
  }

  let pageToken: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    pageToken = body.pageToken || undefined
  } catch { /* no body */ }

  try {
    const youtube = createYouTubeService(apiKey)
    const { videos, nextPageToken } = await youtube.getChannelVideos(channelId, 50, pageToken)

    if (videos.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No videos found', nextPageToken: null })
    }

    const rows = videos.map((v) => ({
      user_id: user.id,
      youtube_video_id: v.youtubeVideoId,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnailUrl,
      channel_id: v.channelId,
      channel_title: v.channelTitle,
      published_at: v.publishedAt,
      view_count: v.viewCount,
      duration_seconds: v.durationSeconds,
      is_vertical: v.isVertical,
    }))

    // Detect truly new videos (not already in DB) before upsert
    const incomingIds = videos.map(v => v.youtubeVideoId)
    const { data: existing } = await supabase
      .from('youtube_videos')
      .select('youtube_video_id')
      .eq('user_id', user.id)
      .in('youtube_video_id', incomingIds)
    const existingIds = new Set((existing ?? []).map((r: { youtube_video_id: string }) => r.youtube_video_id))
    const newVideos = videos.filter(v => !existingIds.has(v.youtubeVideoId))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('youtube_videos')
      .upsert(rows, { onConflict: 'user_id,youtube_video_id' })

    if (error) throw error

    return NextResponse.json({ synced: videos.length, newCount: newVideos.length, nextPageToken: nextPageToken ?? null, channelId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Surface a stable error code when the YouTube API itself rejected us
    // (bad channel id, quota exhausted, key revoked). Lets the client show
    // a more useful nudge than the raw API error string.
    const lower = message.toLowerCase()
    const code = lower.includes('quota') ? 'youtube_quota'
      : lower.includes('not found') || lower.includes('channelnotfound') ? 'channel_not_found'
      : lower.includes('forbidden') || lower.includes('keyinvalid') ? 'api_key_bad'
      : 'youtube_error'
    return NextResponse.json({ error: message, code, channelId }, { status: 500 })
  }
}
