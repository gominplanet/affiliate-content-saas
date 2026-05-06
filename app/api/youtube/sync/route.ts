import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeService } from '@/services/youtube'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  const channelId = process.env.YOUTUBE_CHANNEL_ID

  if (!apiKey || !channelId) {
    return NextResponse.json({ error: 'YouTube API key or Channel ID not configured' }, { status: 400 })
  }

  try {
    const youtube = createYouTubeService(apiKey)
    const videos = await youtube.getChannelVideos(channelId, 50)

    if (videos.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No videos found' })
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
    }))

    const { error } = await supabase
      .from('youtube_videos')
      .upsert(rows, { onConflict: 'user_id,youtube_video_id' })

    if (error) throw error

    return NextResponse.json({ synced: videos.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
