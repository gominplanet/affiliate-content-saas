import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'

// ── GET /api/youtube/calendar ───────────────────────────────────────────────
//
// The data feed for the Co-Pilot planning calendar.
//
// SCAN THE WHOLE LIBRARY. Creators schedule videos up to ~3 months out, pulled
// from a back-catalog of hundreds of unpublished uploads. Scheduling does NOT
// move a video up the uploads playlist (it's ordered by upload date), so those
// scheduled dates are attached to OLD uploads scattered all the way through the
// list. Only a full walk of the uploads playlist surfaces them all — a "recent
// uploads" window misses almost everything (the bug that showed ~5 of ~90).
//
// CACHE THE RESULT. A full walk of an 800+ video library is dozens of
// sequential page fetches (slow + quota-heavy), so we cache the computed events
// per (user, channel) in youtube_calendar_cache (migration 147) and serve from
// it on subsequent loads. `?refresh=1` (the "Refresh from YouTube" button)
// forces a fresh full scan and rewrites the cache. The cache write/read is
// wrapped in try/catch so a pre-migration DB simply falls back to a live scan.
//
// Query params:
//   ?channelId=<UC…|uuid>  scope to a connected channel; omitted → default chan
//   ?refresh=1             bypass the cache and re-scan from YouTube
//
// Returns: { events: [{ youtubeVideoId, title, status, publishAt, publishedAt }], truncated, cached }
//   - scheduled (purple dot): publishAt is set  → plot on publishAt
//   - published (green dot):  status === 'public' → plot on publishedAt

// Cover very large libraries: 60 × 50 = 3,000 videos.
const MAX_PAGES = 60
const PAGE_SIZE = 50
// Serve the cached scan for this long before a fresh full walk is needed.
const CACHE_TTL_MS = 30 * 60 * 1000

// A cold full scan of a few thousand videos is many sequential fetches — give
// it room (cache hits return in well under a second).
export const maxDuration = 120
export const dynamic = 'force-dynamic'

type CalEvent = {
  youtubeVideoId: string
  title: string
  status: string
  publishAt: string | null
  publishedAt: string
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const channelId = (searchParams.get('channelId') || '').trim() || null
    const channelKey = channelId || ''
    const forceRefresh = searchParams.get('refresh') === '1'

    // ── Cache hit ────────────────────────────────────────────────────────────
    if (!forceRefresh) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from('youtube_calendar_cache')
          .select('events,truncated,cached_at')
          .eq('user_id', user.id)
          .eq('channel_id', channelKey)
          .maybeSingle()
        if (data && (Date.now() - new Date(data.cached_at).getTime()) < CACHE_TTL_MS) {
          return NextResponse.json({
            events: Array.isArray(data.events) ? data.events : [],
            truncated: !!data.truncated,
            cached: true,
          })
        }
      } catch { /* table not migrated yet → fall through to a live scan */ }
    }

    // getChannelOAuthToken resolves + refreshes the token for the picked
    // channel, or the user's default channel when channelId is null.
    const token = await getChannelOAuthToken(supabase, user.id, channelId)
    if (!token) {
      return NextResponse.json({ error: 'YouTube OAuth not connected', needsAuth: true }, { status: 401 })
    }

    const yt = createYouTubeOAuthService(token)
    const events: CalEvent[] = []

    // Dedupe by video id: YouTube's playlistItems pagination can return the
    // SAME video on adjacent pages, and a wrapping cursor can re-serve the whole
    // catalog — either way a video would otherwise be plotted twice (the visible
    // "duplicate dots" bug). The drafts endpoint dedupes for the same reason.
    const seen = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | undefined = undefined
    let playlistId: string | undefined = undefined
    let truncated = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const { videos, nextPageToken, uploadsPlaylistId } = await yt.getDraftVideos(PAGE_SIZE, cursor, playlistId)
      playlistId = uploadsPlaylistId
      for (const v of videos) {
        if (!v.youtubeVideoId || seen.has(v.youtubeVideoId)) continue
        seen.add(v.youtubeVideoId)
        events.push({
          youtubeVideoId: v.youtubeVideoId,
          title: v.title,
          status: v.status,
          publishAt: v.publishAt ?? null,
          publishedAt: v.publishedAt,
        })
      }
      if (!nextPageToken) break
      // Stop if the cursor repeats — YouTube occasionally hands back a token that
      // loops to an earlier page, which would re-scan the whole catalog and
      // double every dot. (Dedupe above already neutralizes the symptom; this
      // also saves the wasted fetches.)
      if (seenCursors.has(nextPageToken)) break
      seenCursors.add(nextPageToken)
      cursor = nextPageToken
      // Hit the page cap with a cursor still pending → catalog larger than we
      // scanned; the very oldest uploads aren't included.
      if (page === MAX_PAGES - 1) truncated = true
    }

    // ── Cache write ────────────────────────────────────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('youtube_calendar_cache')
        .upsert({
          user_id: user.id,
          channel_id: channelKey,
          events,
          truncated,
          cached_at: new Date().toISOString(),
        }, { onConflict: 'user_id,channel_id' })
    } catch { /* table not migrated yet → skip caching */ }

    return NextResponse.json({ events, truncated, scanned: seen.size, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Calendar fetch failed' },
      { status: 500 },
    )
  }
}
