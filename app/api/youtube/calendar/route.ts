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

// Page DEEP. The uploads playlist yields well under 50 NEW videos per page on
// large channels (dups + dropped items → ~28/page observed), so a small cap
// stops short of the back-catalog where scheduled videos live. 160 pages covers
// ~4,500 unique even at that yield. The dry-streak guard below stops early when
// the playlist genuinely runs out (or cycles), so we don't waste the budget.
const MAX_PAGES = 200
const PAGE_SIZE = 50
// Bail only after a LONG run of pages that add zero new unique videos. Kept
// high (was 4) so a transient duplicate patch in YouTube's pagination doesn't
// stop us short of the deep back-catalog where scheduled videos live.
const MAX_DRY_PAGES = 30
// Serve the cached scan for this long before a fresh full walk is needed.
const CACHE_TTL_MS = 30 * 60 * 1000

// A cold deep scan of thousands of videos is many sequential fetches — give it
// the full Vercel-Pro budget (cache hits return in well under a second).
export const maxDuration = 300
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
    let dryStreak = 0
    let pagesUsed = 0
    // Why the scan stopped — surfaced for diagnosis:
    //   'exhausted'    YouTube returned no next page (true end of the playlist)
    //   'dry-streak'   too many consecutive pages added nothing new (cycling)
    //   'cursor-loop'  the next-page token repeated
    //   'page-cap'     hit MAX_PAGES with more still pending
    let stopReason = 'page-cap'
    for (let page = 0; page < MAX_PAGES; page++) {
      pagesUsed = page + 1
      const { videos, nextPageToken, uploadsPlaylistId } = await yt.getDraftVideos(PAGE_SIZE, cursor, playlistId)
      playlistId = uploadsPlaylistId
      const before = seen.size
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
      // This page added nothing new → the playlist is exhausted or cycling.
      // Bail after a long run of dry pages so we don't burn the budget.
      if (seen.size === before) {
        if (++dryStreak >= MAX_DRY_PAGES) { stopReason = 'dry-streak'; break }
      } else {
        dryStreak = 0
      }
      if (!nextPageToken) { stopReason = 'exhausted'; break }
      // Stop if the cursor repeats — YouTube occasionally hands back a token that
      // loops to an earlier page, which would re-scan the whole catalog.
      if (seenCursors.has(nextPageToken)) { stopReason = 'cursor-loop'; break }
      seenCursors.add(nextPageToken)
      cursor = nextPageToken
      // Hit the page cap with a cursor still pending → catalog larger than we
      // scanned; the very oldest uploads aren't included.
      if (page === MAX_PAGES - 1) truncated = true
    }

    // ── Second source: search.list (forMine) ─────────────────────────────────
    // The uploads playlist truncates on large channels (it reports "exhausted"
    // before the true count), dropping much of the scheduled back-catalog. A
    // search.list?forMine pass enumerates the user's videos a different way and
    // catches videos the playlist never served. Merge any NEW ones in. Best
    // effort — if it throws (quota / no extra coverage) we keep the playlist
    // results. `searchAdded` is surfaced for diagnosis.
    let searchAdded = 0
    try {
      const viaSearch = await yt.listMyVideosViaSearch(10)
      for (const v of viaSearch) {
        if (!v.youtubeVideoId || seen.has(v.youtubeVideoId)) continue
        seen.add(v.youtubeVideoId)
        searchAdded++
        events.push({
          youtubeVideoId: v.youtubeVideoId,
          title: v.title,
          status: v.status,
          publishAt: v.publishAt ?? null,
          publishedAt: v.publishedAt,
        })
      }
    } catch { /* keep playlist results if search fails */ }

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

    return NextResponse.json({ events, truncated, scanned: seen.size, pagesUsed, stopReason, searchAdded, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Calendar fetch failed' },
      { status: 500 },
    )
  }
}
