// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/scout/whats-new
//
// What the news card (components/dashboard/MvpNews) needs from SCOUT: the
// releases with news, holding only the notes this member's plan can use, and
// the MVP Affiliate channel's three latest videos for the card to play.
//
// THE VIDEOS. YouTube's API first (two quota units, through ytFetch so they
// are counted), because the channel's public feed answered 404 or 500 on five
// tries in six the day this was written; the feed is the fallback. The list
// is kept for 6 hours across every member. When neither answers, the list is
// empty and `videoError` says why, so the card shows a link to the channel
// instead of a blank frame.

import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { ytFetch } from '@/lib/youtube-quota'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { probeShort } from '@/lib/shorts-detect'
import { canUsePreview } from '@/lib/labs-preview'
import { hasVideoTools } from '@/lib/amazon-plan'
import { SCOUT_LATEST_VERSION } from '@/lib/scout-version'
import { MVP_CHANNEL_ID, latestVideos, parseChannelFeed, releasesFor, uploadsPlaylist, watchableVideos, type ChannelVideo, type NoteGate } from '@/lib/scout-news'

export const runtime = 'nodejs'
export const maxDuration = 30

async function readChannelVideos(): Promise<{ videos: ChannelVideo[]; source: 'api' | 'feed' }> {
  let apiWhy = 'no YouTube API key'
  const key = process.env.YOUTUBE_API_KEY
  if (key) {
    try {
      const pl = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
      pl.searchParams.set('part', 'contentDetails')
      pl.searchParams.set('playlistId', uploadsPlaylist(MVP_CHANNEL_ID))
      pl.searchParams.set('maxResults', '50')
      pl.searchParams.set('key', key)
      const r = await ytFetch(pl.toString(), { timeoutMs: 10_000 })
      if (!r.ok) throw new Error(`YouTube answered ${r.status} for the uploads list`)
      const ids = ((await r.json())?.items || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((i: any) => i?.contentDetails?.videoId).filter((id: unknown) => typeof id === 'string')
      if (ids.length) {
        const v = new URL('https://www.googleapis.com/youtube/v3/videos')
        v.searchParams.set('part', 'snippet,contentDetails,status')
        v.searchParams.set('id', ids.join(','))
        v.searchParams.set('key', key)
        const rv = await ytFetch(v.toString(), { timeoutMs: 10_000 })
        if (!rv.ok) throw new Error(`YouTube answered ${rv.status} for the video details`)
        const videos = watchableVideos((await rv.json())?.items || [])
        if (videos.length) return { videos, source: 'api' }
        apiWhy = 'no public long videos in the channel’s last 50 uploads'
      } else apiWhy = 'the uploads list was empty'
    } catch (e) { apiWhy = e instanceof Error ? e.message : String(e) }
  }
  let feedWhy = 'the channel feed did not answer'
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${MVP_CHANNEL_ID}`, { timeoutMs: 8_000 })
      if (!r.ok) { feedWhy = `the channel feed answered ${r.status}`; continue }
      // The feed links a Short to /watch like any video, so each one is
      // asked at youtube.com/shorts/<id>; one that cannot tell stays in.
      const listed = parseChannelFeed(await r.text())
      const shorts = await Promise.all(listed.map((v) => probeShort(v.id)))
      const videos = listed.filter((_, k) => shorts[k] !== true)
      if (videos.length) return { videos, source: 'feed' }
      feedWhy = 'the channel feed had no long videos'
    } catch (e) { feedWhy = e instanceof Error ? e.message : String(e) }
  }
  // Thrown, so nothing is kept: the next card asks again.
  throw new Error(`${apiWhy}; ${feedWhy}`)
}

const channelVideos = unstable_cache(readChannelVideos, ['mvp-channel-videos-v1'], { revalidate: 6 * 3600 })

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (data as { tier?: string | null } | null)?.tier ?? null
  const can = (gate: NoteGate) => gate === 'video_tools' ? hasVideoTools(tier) : canUsePreview(gate, tier)

  let videos: ChannelVideo[] = []
  let videoSource: 'api' | 'feed' | null = null
  let videoError: string | null = null
  try {
    const got = await channelVideos()
    videos = latestVideos(got.videos)
    videoSource = got.source
  } catch (e) { videoError = e instanceof Error ? e.message : String(e) }

  return NextResponse.json({ latest: SCOUT_LATEST_VERSION, releases: releasesFor(can), videos, videoSource, videoError })
}
