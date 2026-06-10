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
    const MAX_PAGES = 15
    // TWO thresholds, both must be satisfied (or MAX_PAGES / catalogue end):
    //   - MIN_DRAFT_HITS: enough drafts overall to populate the No-product /
    //     scheduled tabs.
    //   - MIN_PRODUCT_HITS: enough RAW PRODUCT drafts (an ASIN in the title) so
    //     the "With product" tab isn't empty.
    // Why the product gate (2026-06-10): a creator's newest drafts are often the
    // polished, already-scheduled videos (full title, no raw ASIN). The scan used
    // to stop at the first 10 drafts — all of which were scheduled/no-ASIN — so
    // "With product" showed 0 even though raw "Product name B0XXXXXXXX" drafts
    // existed DEEPER in the uploads list. Counting title-ASIN drafts makes the
    // scan dig past the polished ones until it surfaces the product drafts. The
    // client's loadAll() chains the cursor for anything beyond MAX_PAGES.
    const MIN_DRAFT_HITS = 12
    const MIN_PRODUCT_HITS = 6
    const drafts: Array<Awaited<ReturnType<typeof yt.getDraftVideos>>['videos'][number]> = []
    let cursor: string | undefined = pageToken
    let pagesScanned = 0
    let draftHits = 0
    let productHits = 0
    while (pagesScanned < MAX_PAGES && (draftHits < MIN_DRAFT_HITS || productHits < MIN_PRODUCT_HITS)) {
      const page = await yt.getDraftVideos(50, cursor)
      pagesScanned++
      for (const v of page.videos) {
        const isDraft = v.status !== 'public'
        if (isDraft) {
          draftHits++
          if (v.detectedAsin) productHits++ // raw title-ASIN draft → "With product"
        }
        if (includePublished || isDraft) drafts.push(v)
      }
      if (!page.nextPageToken) {
        cursor = undefined
        break
      }
      cursor = page.nextPageToken
    }

    // ── Enrich with Co-Pilot push state (2026-06-08) ─────────────────────
    // Look up which of these videos the user has pushed via Co-Pilot
    // (/api/youtube/apply or /api/youtube/update-metadata). Powers the
    // "🚀 Pushed via Co-Pilot" tab. Best-effort — if the lookup fails we
    // just return drafts without the badge.
    //
    // Reads from youtube_copilot_pushes (migration 109). The earlier
    // attempt joined against youtube_videos.youtube_metadata_applied_at
    // but the write side couldn't populate that column for users who
    // never run /api/youtube/sync (the table has NOT NULL columns that
    // would block the INSERT branch of the upsert).
    const videoIds = drafts.map(d => d.youtubeVideoId).filter(Boolean)
    const appliedMap: Record<string, string> = {}
    if (videoIds.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: applied } = await (supabase as any)
          .from('youtube_copilot_pushes')
          .select('youtube_video_id, pushed_at')
          .eq('user_id', user.id)
          .in('youtube_video_id', videoIds)
        if (Array.isArray(applied)) {
          for (const row of applied) {
            if (row.youtube_video_id && row.pushed_at) {
              appliedMap[row.youtube_video_id as string] = row.pushed_at as string
            }
          }
        }
      } catch (err) {
        console.warn('[yt-drafts] copilot-push lookup failed (non-fatal):', err instanceof Error ? err.message : String(err))
      }
    }

    const enriched = drafts.map(d => ({
      ...d,
      // ISO timestamp when we last pushed metadata to YouTube for this video
      // via Co-Pilot, or null if never. Client uses this to classify into the
      // "🚀 Pushed via Co-Pilot" tab. Field name kept as metadataAppliedAt
      // for client compatibility (the studio page already reads this key).
      metadataAppliedAt: appliedMap[d.youtubeVideoId] ?? null,
    }))

    // Debug view (?debug=1): per-video classification inputs so we can see
    // exactly what loaded + how each would bucket, without guessing. Read-only.
    if (searchParams.get('debug') === '1') {
      return NextResponse.json({
        pagesScanned,
        draftHits,
        totalLoaded: enriched.length,
        hasMore: !!cursor,
        videos: enriched.map(d => ({
          title: (d.title || '').slice(0, 70),
          status: d.status,
          scheduled: !!d.publishAt,
          asin: d.detectedAsin || null,
          pushedViaCopilot: !!d.metadataAppliedAt,
        })),
      })
    }

    return NextResponse.json({
      drafts: enriched,
      nextPageToken: cursor,
      pagesScanned,
      // Useful for telemetry + debugging the "I'm missing drafts" thread.
      includePublished,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // YouTube Data API daily quota (10k units, resets ~midnight Pacific) or a
    // short-term rate limit. Heavy refreshing/searching burns it fast. Surface
    // it CLEARLY — previously this fell through to a generic 500 / empty list,
    // which looked exactly like "my videos vanished" ("worked then stopped").
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|\bquota\b/i.test(msg)) {
      return NextResponse.json({
        error: 'YouTube’s daily API quota is used up (heavy refreshing/searching uses it fast). It resets around midnight Pacific — your videos will load again then.',
        quotaExceeded: true,
      }, { status: 429 })
    }
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
