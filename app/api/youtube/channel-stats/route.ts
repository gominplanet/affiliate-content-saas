import { NextResponse } from 'next/server'
import { ytFetch, isQuotaRefusalBody, QUOTA_WAIT_TEXT } from '@/lib/youtube-quota'
import { createServerClient } from '@/lib/supabase/server'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('youtube_channel_id')
    .eq('user_id', user.id)
    .single()

  const channelId = intRow?.youtube_channel_id
  if (!channelId) return NextResponse.json(null)

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json(null)

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.searchParams.set('part', 'snippet,statistics')
    url.searchParams.set('id', channelId)
    url.searchParams.set('key', apiKey)

    const res = await ytFetch(url.toString())
    // A USED-UP ALLOWANCE IS NOT A MISSING CHANNEL. null makes the card say
    // "Add your YouTube channel ID in Settings" to a creator who has one.
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return NextResponse.json(isQuotaRefusalBody(body) ? { unavailable: `Channel stats cannot load right now. ${QUOTA_WAIT_TEXT}` } : null)
    }

    const json = await res.json()
    const item = json.items?.[0]
    if (!item) return NextResponse.json(null)

    const { snippet, statistics } = item

    // Count videos published in last 30 days from our DB
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: recentVideos } = await supabase
      .from('youtube_videos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('published_at', thirtyDaysAgo)

    return NextResponse.json({
      title: snippet.title,
      thumbnail: snippet.thumbnails?.default?.url ?? '',
      currentStats: {
        subscribers: parseInt(statistics.subscriberCount ?? '0', 10),
        views: parseInt(statistics.viewCount ?? '0', 10),
        videos: parseInt(statistics.videoCount ?? '0', 10),
      },
      growth: {
        subscribersGained: 0,
        viewsGained: 0,
        videosPublished: recentVideos ?? 0,
      },
      syncedAt: 'just now',
    })
  } catch {
    return NextResponse.json(null)
  }
}
