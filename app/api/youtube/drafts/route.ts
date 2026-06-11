import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'

// Cache TTL: 15 minutes.  Reads within this window return DB rows — zero
// YouTube API units.  Explicit ?refresh=1 forces a re-scan regardless of age.
const CACHE_TTL_MS = 15 * 60 * 1000

// ── Cache helpers ─────────────────────────────────────────────────────────────

interface CacheRow {
  uploads_playlist_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any[]
  cached_at: string
  full_scan: boolean
}

async function readCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<CacheRow | null> {
  const { data } = await (supabase as any)
    .from('youtube_video_cache')
    .select('uploads_playlist_id,videos,cached_at,full_scan')
    .eq('user_id', userId)
    .maybeSingle()
  return data ?? null
}

async function writeCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  uploadsPlaylistId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any[],
  fullScan: boolean,
): Promise<void> {
  await (supabase as any)
    .from('youtube_video_cache')
    .upsert({
      user_id: userId,
      uploads_playlist_id: uploadsPlaylistId,
      videos,
      video_count: videos.length,
      cached_at: new Date().toISOString(),
      full_scan: fullScan,
    }, { onConflict: 'user_id' })
}

// Bust the cache so the next load forces a fresh scan (called after Apply push)
export async function bustYouTubeCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<void> {
  await (supabase as any)
    .from('youtube_video_cache')
    .update({ cached_at: new Date(0).toISOString() })
    .eq('user_id', userId)
}

// ── ASIN detector (shared between scan and cache read) ───────────────────────

function detectAsin(title: string): string | null {
  const m = title.match(/\b([A-Z0-9]{10})\b/)
  return m ? m[1] : null
}

// ── GET /api/youtube/drafts ───────────────────────────────────────────────────
//
// Query params:
//   ?refresh=1           force re-scan, ignore cache age
//   ?q=<term>            search titles in the cached video list (no search.list call)
//   ?pageToken=<cursor>  continue a previous scan beyond MAX_PAGES
//   ?includePublished=1  include public videos in the returned list
//   ?debug=1             verbose classification view (admin only)

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    if (needsRefresh) {
      await supabase
        .from('integrations')
        .update({
          youtube_oauth_access_token: token,
          youtube_oauth_token_expiry: Date.now() + 3600 * 1000,
        })
        .eq('user_id', user.id)
    }

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === '1'
    const pageToken = searchParams.get('pageToken') || undefined
    const q = (searchParams.get('q') || '').trim().slice(0, 200)
    const includePublished = searchParams.get('includePublished') === '1'

    // ── Search mode: filter the cache — never call search.list (100 units) ──
    // search.list is 100× more expensive than videos.list. Instead we keep all
    // videos in the cache (drafts + public) and do a cheap in-memory title
    // filter here.  If the cache is empty we fall through to a full scan first.
    if (q && !pageToken) {
      const cache = await readCache(supabase, user.id)
      const cacheAge = cache ? Date.now() - new Date(cache.cached_at).getTime() : Infinity

      let allVideos: ReturnType<typeof buildDraftVideo>[]
      if (cache && cacheAge < CACHE_TTL_MS) {
        // Fresh cache — search in memory, 0 API units
        allVideos = cache.videos
      } else {
        // Stale / empty — populate the cache first, then search
        const yt = createYouTubeOAuthService(token)
        allVideos = await runFullScan(yt, supabase, user.id, cache?.uploads_playlist_id, undefined)
      }

      const lower = q.toLowerCase()
      const matched = allVideos.filter(
        (v: ReturnType<typeof buildDraftVideo>) =>
          v.title.toLowerCase().includes(lower) ||
          (v.description ?? '').toLowerCase().includes(lower),
      )
      return NextResponse.json({ drafts: matched, query: q, fromCache: true })
    }

    // ── Load-more (cursor continuation) — always hits the API ────────────────
    // pageToken means the client is asking for the NEXT page beyond what the
    // initial scan returned.  We run the scan from the cursor, append to the
    // cache, and return the new batch.
    if (pageToken) {
      const yt = createYouTubeOAuthService(token)
      const cache = await readCache(supabase, user.id)
      const existingVideos: ReturnType<typeof buildDraftVideo>[] = cache?.videos ?? []
      const uploadsPlaylistId = cache?.uploads_playlist_id

      const newVideos = await runFullScan(
        yt, supabase, user.id, uploadsPlaylistId, pageToken,
      )

      // Merge with existing cache (dedup by id), persist
      const seen = new Set(existingVideos.map((v: ReturnType<typeof buildDraftVideo>) => v.youtubeVideoId))
      const merged = [...existingVideos, ...newVideos.filter(
        (v: ReturnType<typeof buildDraftVideo>) => !seen.has(v.youtubeVideoId),
      )]
      const playlistId = newVideos[0]
        ? cache?.uploads_playlist_id ?? ''
        : cache?.uploads_playlist_id ?? ''
      await writeCache(supabase, user.id, playlistId, merged, false)

      const filtered = newVideos.filter(
        (v: ReturnType<typeof buildDraftVideo>) => includePublished || v.status !== 'public',
      )
      return NextResponse.json({
        drafts: await enrichWithPushState(supabase, user.id, filtered),
        nextPageToken: (newVideos as any).__cursor,
        pagesScanned: (newVideos as any).__pages,
        includePublished,
      })
    }

    // ── Default load: serve from cache if fresh, scan if stale/forced ────────
    const cache = await readCache(supabase, user.id)
    const cacheAge = cache ? Date.now() - new Date(cache.cached_at).getTime() : Infinity
    const usedCache = cache && cacheAge < CACHE_TTL_MS && !forceRefresh

    let allVideos: ReturnType<typeof buildDraftVideo>[]
    let nextCursor: string | undefined

    if (usedCache) {
      // Serve entirely from Supabase — 0 YouTube API units
      allVideos = cache!.videos
      nextCursor = undefined
    } else {
      // Cache is stale / missing / forced: run the scan
      const yt = createYouTubeOAuthService(token)
      const result = await runFullScanWithCursor(
        yt, supabase, user.id, cache?.uploads_playlist_id,
      )
      allVideos = result.videos
      nextCursor = result.nextCursor
    }

    const drafts = allVideos.filter(
      (v: ReturnType<typeof buildDraftVideo>) => includePublished || v.status !== 'public',
    )

    if (searchParams.get('debug') === '1') {
      return NextResponse.json({
        fromCache: usedCache,
        cacheAgeMinutes: Math.round(cacheAge / 60000),
        totalCached: allVideos.length,
        totalDrafts: drafts.length,
        videos: drafts.map((d: ReturnType<typeof buildDraftVideo>) => ({
          title: (d.title || '').slice(0, 70),
          status: d.status,
          scheduled: !!d.publishAt,
          asin: d.detectedAsin || null,
        })),
      })
    }

    return NextResponse.json({
      drafts: await enrichWithPushState(supabase, user.id, drafts),
      nextPageToken: nextCursor,
      fromCache: usedCache,
      includePublished,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|\bquota\b/i.test(msg)) {
      return NextResponse.json({
        error: 'YouTube\'s daily API quota is used up (heavy refreshing/searching uses it fast). It resets around midnight Pacific — your videos will load again then.',
        quotaExceeded: true,
      }, { status: 429 })
    }
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDraftVideo(v: Record<string, unknown>) {
  const snippet = v.snippet as Record<string, unknown>
  const status = v.status as Record<string, unknown>
  const thumbs = (snippet?.thumbnails ?? {}) as Record<string, { url: string } | undefined>
  return {
    youtubeVideoId: v.id as string,
    title: (snippet?.title as string) ?? '',
    description: (snippet?.description as string) ?? '',
    thumbnailUrl: thumbs?.high?.url ?? thumbs?.default?.url ?? '',
    status: (status?.privacyStatus as 'private' | 'unlisted' | 'public') ?? 'private',
    publishedAt: (snippet?.publishedAt as string) ?? '',
    publishAt: (status?.publishAt as string | null) ?? null,
    detectedAsin: detectAsin((snippet?.title as string) ?? ''),
  }
}

// Scan up to MAX_PAGES, return the accumulated videos + a continuation cursor.
// When MAX_PAGES is hit with a cursor remaining, the cursor is returned so
// "Load more" can continue — we don't claim full_scan=true unless the cursor
// is actually exhausted.
const MAX_PAGES = 15
const MIN_DRAFT_HITS = 12
const MIN_PRODUCT_HITS = 6

async function runFullScanWithCursor(
  yt: ReturnType<typeof createYouTubeOAuthService>,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  cachedPlaylistId?: string,
): Promise<{ videos: ReturnType<typeof buildDraftVideo>[]; nextCursor?: string }> {
  const accumulated: ReturnType<typeof buildDraftVideo>[] = []
  let cursor: string | undefined
  let pagesScanned = 0
  let draftHits = 0
  let productHits = 0
  let uploadsPlaylistId = cachedPlaylistId
  let hitPageLimit = false

  while (pagesScanned < MAX_PAGES) {
    const page = await yt.getDraftVideos(50, cursor, uploadsPlaylistId)
    uploadsPlaylistId = page.uploadsPlaylistId
    pagesScanned++
    for (const v of page.videos) {
      accumulated.push(v as ReturnType<typeof buildDraftVideo>)
      if (v.status !== 'public') {
        draftHits++
        if (v.detectedAsin) productHits++
      }
    }
    // Stop scanning if we hit both minimums (unless we haven't scanned much yet)
    if (draftHits >= MIN_DRAFT_HITS && productHits >= MIN_PRODUCT_HITS && pagesScanned >= 3) {
      if (!page.nextPageToken) { cursor = undefined } else { cursor = page.nextPageToken }
      break
    }
    // Page limit reached — preserve the cursor for continuation
    if (pagesScanned >= MAX_PAGES) {
      hitPageLimit = true
      cursor = page.nextPageToken
      break
    }
    // More pages exist
    if (!page.nextPageToken) { cursor = undefined; break }
    cursor = page.nextPageToken
  }

  // Persist what we scanned. full_scan=true only if we actually exhausted the playlist.
  const isFullyScanFull = !cursor && !hitPageLimit
  if (uploadsPlaylistId) {
    await writeCache(supabase, userId, uploadsPlaylistId, accumulated, isFullyScanFull)
  }

  return { videos: accumulated, nextCursor: cursor }
}

// Simplified scan for search-fallback and cursor-continuation paths.
// Returns videos only (no cursor tracking needed by callers).
async function runFullScan(
  yt: ReturnType<typeof createYouTubeOAuthService>,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  cachedPlaylistId?: string,
  fromPageToken?: string,
): Promise<ReturnType<typeof buildDraftVideo>[]> {
  const result = await runFullScanWithCursor(yt, supabase, userId, cachedPlaylistId)
  return result.videos
}

// Enrich drafts with Co-Pilot push timestamps (best-effort, non-blocking)
async function enrichWithPushState(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  drafts: ReturnType<typeof buildDraftVideo>[],
) {
  const videoIds = drafts.map(d => d.youtubeVideoId).filter(Boolean)
  const appliedMap: Record<string, string> = {}
  if (videoIds.length > 0) {
    try {
      const { data: applied } = await (supabase as any)
        .from('youtube_copilot_pushes')
        .select('youtube_video_id,pushed_at')
        .eq('user_id', userId)
        .in('youtube_video_id', videoIds)
      if (Array.isArray(applied)) {
        for (const row of applied) {
          if (row.youtube_video_id && row.pushed_at) {
            appliedMap[row.youtube_video_id as string] = row.pushed_at as string
          }
        }
      }
    } catch (err) {
      console.warn('[yt-drafts] push-state lookup failed (non-fatal):', err instanceof Error ? err.message : String(err))
    }
  }
  return drafts.map(d => ({ ...d, metadataAppliedAt: appliedMap[d.youtubeVideoId] ?? null }))
}
