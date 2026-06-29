import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'

// ── GET /api/youtube/calendar ───────────────────────────────────────────────
//
// A lightweight, ALWAYS-FRESH feed for the Co-Pilot planning calendar. Unlike
// /api/youtube/drafts (15-min cache, paginated to-do view), this pulls the
// newest uploads straight from YouTube on every call. That's deliberate: a
// video scheduled DIRECTLY in YouTube Studio (not through MVP) carries its
// schedule in `status.publishAt`, and we want the calendar dot to reflect it
// the moment it's set — no waiting on a cache or a manual re-scan.
//
// We scan the most recent ~150 uploads (3 pages of 50). The uploads playlist
// contains every video regardless of privacy (public / unlisted / private /
// scheduled), so this one pass covers both upcoming-scheduled and
// recently-published videos — which is the window a planning calendar cares
// about. Quota is ~6 units per call (cheap), so freshness costs little.
//
// Query params:
//   ?channelId=<UC…|uuid>   scope to a specific connected channel (the
//                           Co-Pilot channel picker). Omitted → default channel.
//
// Returns: { events: [{ youtubeVideoId, title, status, publishAt, publishedAt }] }
//   - scheduled (purple dot): publishAt is set  → plot on publishAt
//   - published (green dot):  status === 'public' → plot on publishedAt

const MAX_PAGES = 3
const PAGE_SIZE = 50

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const channelId = (searchParams.get('channelId') || '').trim() || null

    // getChannelOAuthToken resolves + refreshes the token for the picked
    // channel, or the user's default channel when channelId is null.
    const token = await getChannelOAuthToken(supabase, user.id, channelId)
    if (!token) {
      return NextResponse.json({ error: 'YouTube OAuth not connected', needsAuth: true }, { status: 401 })
    }

    const yt = createYouTubeOAuthService(token)
    const events: Array<{
      youtubeVideoId: string
      title: string
      status: string
      publishAt: string | null
      publishedAt: string
    }> = []

    let cursor: string | undefined = undefined
    let playlistId: string | undefined = undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const { videos, nextPageToken, uploadsPlaylistId } = await yt.getDraftVideos(PAGE_SIZE, cursor, playlistId)
      playlistId = uploadsPlaylistId
      for (const v of videos) {
        events.push({
          youtubeVideoId: v.youtubeVideoId,
          title: v.title,
          status: v.status,
          publishAt: v.publishAt ?? null,
          publishedAt: v.publishedAt,
        })
      }
      if (!nextPageToken) break
      cursor = nextPageToken
    }

    return NextResponse.json({ events })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Calendar fetch failed' },
      { status: 500 },
    )
  }
}
