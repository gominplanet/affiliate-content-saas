import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.youtube_oauth_access_token) {
    return NextResponse.json({ error: 'YouTube OAuth not connected', needsAuth: true }, { status: 401 })
  }

  try {
    const intData = intRow as Record<string, unknown>
    const expiry = intData.youtube_oauth_token_expiry as number | null
    const needsRefresh = expiry && Date.now() > expiry - 120_000
    const token = await getValidYouTubeToken(intData)

    // Persist refreshed token
    if (needsRefresh) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase
        .from('integrations')
        .update({
          youtube_oauth_access_token: token,
          youtube_oauth_token_expiry: Date.now() + 3600 * 1000,
        })
        .eq('user_id', user.id)
    }

    const { searchParams } = new URL(request.url)
    const pageToken = searchParams.get('pageToken') || undefined
    // q triggers full-catalogue search (search.list, forMine=true) instead
    // of the default uploads-playlist listing. Trimmed + length-capped so a
    // pathological query can't blow the YouTube quota in one call.
    const q = (searchParams.get('q') || '').trim().slice(0, 200)
    // includePublished=1 surfaces published videos too. Default behaviour
    // (false) filters to drafts only — private + unlisted — because that's
    // what Co-Pilot actually targets (you don't regenerate metadata on a
    // live video without taking down ads/audience etc).
    const includePublished = searchParams.get('includePublished') === '1'

    const yt = createYouTubeOAuthService(token)

    // When the Studio's search bar is in use we hit the search endpoint
    // (covers the whole channel) and skip the privacy filter — creators
    // searching for a specific video shouldn't have the result hidden just
    // because it's public.
    if (q) {
      const result = await yt.searchMyVideos(q, 25, pageToken)
      return NextResponse.json({ drafts: result.videos, nextPageToken: result.nextPageToken, query: q })
    }

    // Default listing: walk pages of 50 from the uploads playlist, filter
    // out public videos (so only true drafts surface), keep scanning until
    // we've collected MIN_HITS hits OR exhausted the catalogue OR scanned
    // MAX_PAGES (quota guard). Returns the accumulated drafts + a cursor
    // the client can re-submit for the next round-trip.
    //
    // Why aggregate server-side instead of relying on next/prev UI:
    //   - A creator with 200 uploaded videos but only 7 unpublished drafts
    //     would otherwise see "page 1: 0 drafts, page 2: 0 drafts, …"
    //     and assume Refresh is broken (the actual complaint that drove
    //     this change). One round-trip now returns all 7 in one click.
    //   - The Co-Pilot UI has a "Load all drafts" button that re-submits
    //     the cursor in a loop until exhausted — each round-trip is fast
    //     and the user sees the count climb live ("Loaded 47… 95…").
    //   - Quota cost: each playlistItems page is 1 unit, each videos
    //     details lookup is 1 unit. 10 pages = 20 units, well under the
    //     10k/day default channel quota.
    const MAX_PAGES = 10
    // MIN_HITS=10 keeps the first batch fast so the user sees content
    // immediately. The client's loadAll() chains round-trips until the
    // cursor is null, so a small MIN_HITS doesn't lose any drafts — it
    // just keeps each round-trip short.
    const MIN_HITS = 10
    const drafts: Array<Awaited<ReturnType<typeof yt.getDraftVideos>>['videos'][number]> = []
    let cursor: string | undefined = pageToken
    let pagesScanned = 0
    while (pagesScanned < MAX_PAGES && drafts.length < MIN_HITS) {
      const page = await yt.getDraftVideos(50, cursor)
      pagesScanned++
      const matching = page.videos.filter(v => includePublished || v.status !== 'public')
      drafts.push(...matching)
      if (!page.nextPageToken) {
        cursor = undefined
        break
      }
      cursor = page.nextPageToken
    }

    // ── Enrich with Co-Pilot apply state (2026-06-08) ────────────────────
    // Look up which of these videos the user has already pushed metadata
    // for via /api/youtube/apply or /api/youtube/update-metadata. Powers
    // the "🚀 Pushed via Co-Pilot" tab on the Co-Pilot page. Best-effort
    // — if the lookup fails we just return drafts without the badge.
    const videoIds = drafts.map(d => d.youtubeVideoId).filter(Boolean)
    const appliedMap: Record<string, string> = {}
    if (videoIds.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: applied } = await (supabase as any)
          .from('youtube_videos')
          .select('youtube_video_id, youtube_metadata_applied_at')
          .eq('user_id', user.id)
          .in('youtube_video_id', videoIds)
          .not('youtube_metadata_applied_at', 'is', null)
        if (Array.isArray(applied)) {
          for (const row of applied) {
            if (row.youtube_video_id && row.youtube_metadata_applied_at) {
              appliedMap[row.youtube_video_id as string] = row.youtube_metadata_applied_at as string
            }
          }
        }
      } catch (err) {
        console.warn('[yt-drafts] applied-at lookup failed (non-fatal):', err instanceof Error ? err.message : String(err))
      }
    }

    const enriched = drafts.map(d => ({
      ...d,
      // ISO timestamp when we last pushed metadata to YouTube for this video,
      // or null if we never have. The client uses this to classify into the
      // "Pushed via Co-Pilot" tab.
      metadataAppliedAt: appliedMap[d.youtubeVideoId] ?? null,
    }))

    return NextResponse.json({
      drafts: enriched,
      nextPageToken: cursor,
      pagesScanned,
      // Useful for telemetry + debugging the "I'm missing drafts" thread.
      includePublished,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Token refresh failed or token rejected by Google → ask user to reconnect
    const isAuthError =
      msg.includes('Failed to refresh YouTube token') ||
      msg.includes('YouTube OAuth not connected') ||
      msg.includes('YouTube token expired') ||
      msg.includes('401')
    if (isAuthError) {
      return NextResponse.json({ error: 'YouTube session expired', needsAuth: true }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
