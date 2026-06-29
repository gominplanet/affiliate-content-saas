import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'

// ── GET /api/youtube/calendar ───────────────────────────────────────────────
//
// An ALWAYS-FRESH feed for the Co-Pilot planning calendar. Unlike
// /api/youtube/drafts (15-min cache, paginated to-do view), this pulls straight
// from YouTube on every call. That's deliberate: a video scheduled DIRECTLY in
// YouTube Studio carries its schedule in `status.publishAt`, and we want the
// dot to reflect it the moment it's set — no cache, no manual re-scan.
//
// IMPORTANT — we scan the FULL uploads playlist, not just the newest page.
// Scheduling does NOT move a video up the uploads list (it's ordered by upload
// date), so a creator who schedules videos out of their back-catalog has
// scheduled dates attached to OLD uploads scattered deep in the list. A small
// "recent uploads" window misses almost all of them — which is exactly the bug
// that showed only a few of ~90 scheduled videos. So we walk every page until
// the cursor is exhausted (capped at MAX_PAGES for safety). Each page is
// ~2 quota units; a 1,500-video channel is ~30 pages (~60 units) — affordable,
// and the client loads the calendar async so the scan never blocks the page.
//
// Query params:
//   ?channelId=<UC…|uuid>   scope to a specific connected channel (the
//                           Co-Pilot channel picker). Omitted → default channel.
//
// Returns: { events: [{ youtubeVideoId, title, status, publishAt, publishedAt }], truncated }
//   - scheduled (purple dot): publishAt is set  → plot on publishAt
//   - published (green dot):  status === 'public' → plot on publishedAt

// Generous cap so even large catalogs are fully covered (40 × 50 = 2,000 videos).
const MAX_PAGES = 40
const PAGE_SIZE = 50

// Big channels can need ~30+ sequential page fetches — give the scan room.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

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

    return NextResponse.json({ events, truncated })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Calendar fetch failed' },
      { status: 500 },
    )
  }
}
