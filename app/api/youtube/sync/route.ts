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
    return NextResponse.json({ error: 'YouTube API key not configured' }, { status: 400 })
  }

  // Read per-user channel ID from integrations table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('youtube_channel_id')
    .eq('user_id', user.id)
    .single()

  const channelId = intRow?.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID
  if (!channelId) {
    return NextResponse.json({ error: 'No YouTube channel ID configured. Add your channel ID in Blog Setup → Integrations.' }, { status: 400 })
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

    const { error } = await supabase
      .from('youtube_videos')
      .upsert(rows, { onConflict: 'user_id,youtube_video_id' })

    if (error) throw error

    return NextResponse.json({ synced: videos.length, newCount: newVideos.length, nextPageToken: nextPageToken ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
