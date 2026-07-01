import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'

// Cache freshness window: 15 minutes. Reads within this window return DB rows —
// zero YouTube API units. OLDER-but-present → a cheap incremental top-up of just
// the newest pages (a few units), NOT a full re-scan. Explicit ?refresh=1 always
// forces the full to-do scan regardless of age.
const CACHE_TTL_MS = 15 * 60 * 1000
// Incremental top-up depth for a stale-but-present cache: new uploads land at the
// TOP of the uploads list, so the newest couple of pages catch them for a handful
// of quota units — instead of re-running the deeper to-do scan on every open.
const TOPUP_PAGES = 2

// ── Cache helpers ─────────────────────────────────────────────────────────────

interface CacheRow {
  uploads_playlist_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any[]
  cached_at: string
  full_scan: boolean
  next_cursor?: string | null
}

async function readCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<CacheRow | null> {
  // ONE query incl. next_cursor (migration 132). If the column is absent on a
  // pre-migration DB the select 400s — fall back to the legacy projection.
  // Saves a round-trip on every cached drafts load.
  try {
    const { data, error } = await (supabase as any)
      .from('youtube_video_cache')
      .select('uploads_playlist_id,videos,cached_at,full_scan,next_cursor')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return data ? { ...data, next_cursor: data.next_cursor ?? null } : null
  } catch {
    const { data } = await (supabase as any)
      .from('youtube_video_cache')
      .select('uploads_playlist_id,videos,cached_at,full_scan')
      .eq('user_id', userId)
      .maybeSingle()
    return data ? { ...data, next_cursor: null } : null
  }
}

async function writeCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  uploadsPlaylistId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any[],
  fullScan: boolean,
  nextCursor?: string | null,
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
  // Persist the continuation cursor in a SEPARATE update so a pre-migration
  // (column-absent) DB can never break the primary cache write above. Pass
  // null on an exhausted scan to clear a stale cursor; undefined = leave as-is.
  if (nextCursor !== undefined) {
    try {
      await (supabase as any)
        .from('youtube_video_cache')
        .update({ next_cursor: nextCursor })
        .eq('user_id', userId)
    } catch { /* column not migrated yet — cursor simply isn't persisted */ }
  }
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
//   ?q=<term>            search the cached video list; on a cache MISS, fall
//                        back to a channel-wide search.list (100 units) so the
//                        bar finds any video on the channel, not just the
//                        loaded window
//   ?pageToken=<cursor>  continue a previous scan beyond MAX_PAGES
//   ?includePublished=1  include public videos in the returned list
//   ?debug=1             verbose classification view (admin only)

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: intRow } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .single()

  try {
    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === '1'
    const pageToken = searchParams.get('pageToken') || undefined
    const q = (searchParams.get('q') || '').trim().slice(0, 200)
    // Which YouTube channel to list. Explicit ?channelId=<UC…|uuid> (the
    // Co-Pilot channel picker) scopes everything to that channel; otherwise we
    // resolve the user's DEFAULT channel (youtube_channels, falling back to the
    // legacy integrations token). getChannelOAuthToken refreshes + persists.
    const channelId = (searchParams.get('channelId') || '').trim() || null
    // When a specific channel is picked we BYPASS the per-user cache entirely
    // (it's keyed by user, not channel) so one channel's videos never bleed
    // into another's. The default view keeps caching as before.
    const channelScoped = !!channelId
    const token = await getChannelOAuthToken(supabase, user.id, channelId)
    if (!token) {
      return NextResponse.json({ error: 'YouTube OAuth not connected', needsAuth: true }, { status: 401 })
    }
    const includePublished = searchParams.get('includePublished') === '1'

    // ── Search mode ─────────────────────────────────────────────────────────
    // search.list (forMine + q) is the AUTHORITATIVE, channel-wide search —
    // exactly what the YouTube Studio search bar uses. We make it the PRIMARY
    // source (not a last-resort fallback): a stray/loose cache substring match
    // must never suppress the real results, and the cache is only a recency
    // window so it misses older uploads anyway. Cost is 100 quota units per
    // query — affordable because the client debounces and only fires on a
    // changed query. Everything is deduped by youtubeVideoId so a duplicated
    // cache entry can't surface the same video twice.
    if (q && !pageToken) {
      const lower = q.toLowerCase()
      const byId = new Map<string, ReturnType<typeof buildDraftVideo>>()
      const add = (v: ReturnType<typeof buildDraftVideo>) => {
        if (v?.youtubeVideoId && !byId.has(v.youtubeVideoId)) byId.set(v.youtubeVideoId, v)
      }

      // 1. Authoritative channel-wide search (any age / privacy status).
      let viaSearch = false
      try {
        const yt = createYouTubeOAuthService(token)
        const { videos: hits } = await yt.searchMyVideos(q, 25)
        ;(hits as unknown as ReturnType<typeof buildDraftVideo>[]).forEach(add)
        viaSearch = hits.length > 0
      } catch { /* quota / transient — fall back to the cache below */ }

      // 2. Supplement with cache TITLE matches (title-only so a loose
      //    description hit can't inject an unrelated video — that was the
      //    "Bamboo Mattress" surfacing for "boom" bug). Fresh cache only — a
      //    search should never trigger a full uploads scan. Skipped entirely
      //    when a specific channel is picked (the cache is per-user, not
      //    per-channel) so live search alone scopes the results.
      const cache = channelScoped ? null : await readCache(supabase, user.id)
      const cacheAge = cache ? Date.now() - new Date(cache.cached_at).getTime() : Infinity
      const cacheFresh = !!cache && cacheAge < CACHE_TTL_MS
      if (cacheFresh) {
        for (const v of cache!.videos as ReturnType<typeof buildDraftVideo>[]) {
          if (v.title.toLowerCase().includes(lower)) add(v)
        }
      }

      // 3. Last resort: search.list failed AND no fresh cache → one scan so the
      //    user isn't left empty on a cold cache.
      if (byId.size === 0 && !cacheFresh) {
        try {
          const yt = createYouTubeOAuthService(token)
          const scanned = await runFullScan(yt, supabase, user.id, cache?.uploads_playlist_id, undefined, !channelScoped)
          for (const v of scanned) {
            if (v.title.toLowerCase().includes(lower) || (v.description ?? '').toLowerCase().includes(lower)) add(v)
          }
        } catch { /* ignore — return whatever we have */ }
      }

      const matched = [...byId.values()]

      // Persist search hits into the cache so later browse/filter sees them.
      if (viaSearch && cache) {
        const seen = new Set((cache.videos as ReturnType<typeof buildDraftVideo>[]).map(v => v.youtubeVideoId))
        const fresh = matched.filter(v => !seen.has(v.youtubeVideoId))
        if (fresh.length) {
          await writeCache(supabase, user.id, cache.uploads_playlist_id || '', [...cache.videos, ...fresh], false)
        }
      }

      return NextResponse.json({
        drafts: await enrichWithPushState(supabase, user.id, matched),
        query: q,
        viaSearch,
        fromCache: !viaSearch,
      })
    }

    // ── Load-more (cursor continuation) — always hits the API ────────────────
    // pageToken means the client is asking for the NEXT page beyond what the
    // initial scan returned.  We run the scan from the cursor, append to the
    // cache, and return the new batch.
    if (pageToken) {
      const yt = createYouTubeOAuthService(token)
      const cache = channelScoped ? null : await readCache(supabase, user.id)
      const existingVideos: ReturnType<typeof buildDraftVideo>[] = cache?.videos ?? []
      const uploadsPlaylistId = cache?.uploads_playlist_id

      // CONTINUE from the cursor (don't restart at page 1). persist=false — we
      // merge with the existing cache below and write THAT, so the cache keeps
      // every video found so far, not just this continuation page.
      const { videos: newVideos, nextCursor, uploadsPlaylistId: resolvedPlaylistId } = await runFullScanWithCursor(
        yt, supabase, user.id, uploadsPlaylistId, pageToken, false,
      )

      // Merge with existing cache (dedup by id), persist with the new cursor +
      // full_scan flag so a later cached load knows whether more remains.
      // Persist the RESOLVED playlist id (never ''), so we don't overwrite a
      // good id with empty and poison the next scan.
      const seen = new Set(existingVideos.map((v: ReturnType<typeof buildDraftVideo>) => v.youtubeVideoId))
      const merged = [...existingVideos, ...newVideos.filter(
        (v: ReturnType<typeof buildDraftVideo>) => !seen.has(v.youtubeVideoId),
      )]
      const playlistToPersist = resolvedPlaylistId || uploadsPlaylistId
      if (playlistToPersist && !channelScoped) {
        await writeCache(
          supabase, user.id, playlistToPersist, merged, !nextCursor, nextCursor ?? null,
        )
      }

      const filtered = newVideos.filter(
        (v: ReturnType<typeof buildDraftVideo>) => includePublished || v.status !== 'public',
      )
      return NextResponse.json({
        drafts: await enrichWithPushState(supabase, user.id, filtered),
        nextPageToken: nextCursor,
        includePublished,
      })
    }

    // ── Default load: cache-first, with a cheap top-up when stale ────────────
    // Fresh cache  → serve as-is (0 units). Stale-but-present → a shallow
    // incremental top-up of just the newest pages (a few units) to pick up new
    // uploads, merged over the cached list. No cache / forced refresh → the full
    // to-do scan. A top-up that fails (e.g. quota) falls back to the cache.
    const cache = channelScoped ? null : await readCache(supabase, user.id)
    const cacheAge = cache ? Date.now() - new Date(cache.cached_at).getTime() : Infinity
    const haveCache = !!cache && Array.isArray(cache.videos) && cache.videos.length > 0
    const cacheFresh = haveCache && cacheAge < CACHE_TTL_MS && !forceRefresh

    let allVideos: ReturnType<typeof buildDraftVideo>[]
    let nextCursor: string | undefined
    let usedCache = false

    if (cacheFresh) {
      // Serve entirely from Supabase — 0 YouTube API units. Surface the stored
      // continuation cursor so "Load more" still works on a cached load when the
      // previous scan stopped early (full_scan=false). An exhausted scan stores
      // no cursor, so the button correctly stays hidden.
      allVideos = cache!.videos
      nextCursor = cache!.full_scan ? undefined : (cache!.next_cursor ?? undefined)
      usedCache = true
    } else if (haveCache && !forceRefresh && !channelScoped) {
      // Stale-but-present → cheap incremental top-up of the newest pages, merged
      // over the cached list (new uploads go on top). Preserve the existing
      // deep-scan frontier (full_scan / next_cursor) so "Load more" still works.
      // If the top-up fails (quota/transient), serve the cached list unchanged.
      const yt = createYouTubeOAuthService(token)
      try {
        const top = await runTopUpScan(yt, cache!.uploads_playlist_id)
        const seen = new Set(cache!.videos.map((v: ReturnType<typeof buildDraftVideo>) => v.youtubeVideoId))
        const fresh = top.videos.filter(v => v.youtubeVideoId && !seen.has(v.youtubeVideoId))
        allVideos = fresh.length ? [...fresh, ...cache!.videos] : cache!.videos
        nextCursor = cache!.full_scan ? undefined : (cache!.next_cursor ?? undefined)
        const playlistToPersist = top.uploadsPlaylistId || cache!.uploads_playlist_id
        if (playlistToPersist) {
          await writeCache(supabase, user.id, playlistToPersist, allVideos, cache!.full_scan, cache!.next_cursor ?? undefined)
        }
      } catch {
        allVideos = cache!.videos
        nextCursor = cache!.full_scan ? undefined : (cache!.next_cursor ?? undefined)
      }
      usedCache = true   // served from cache (+ a light top-up), not a full scan
    } else {
      // No cache, or a forced refresh → run the full to-do scan. If the scan
      // fails (transient YouTube hiccup, a momentary channel-resolve miss, etc.)
      // but we still have cached videos, serve those rather than blanking the
      // page. Quota/auth errors with NO cache still surface via the outer catch.
      const yt = createYouTubeOAuthService(token)
      try {
        const result = await runFullScanWithCursor(
          yt, supabase, user.id, cache?.uploads_playlist_id, undefined, !channelScoped,
        )
        allVideos = result.videos
        nextCursor = result.nextCursor
      } catch (scanErr) {
        if (cache?.videos?.length) {
          allVideos = cache.videos
          nextCursor = cache.full_scan ? undefined : (cache.next_cursor ?? undefined)
        } else {
          throw scanErr
        }
      }
    }

    const drafts = allVideos.filter(
      (v: ReturnType<typeof buildDraftVideo>) => includePublished || v.status !== 'public',
    )

    if (searchParams.get('debug') === '1' && intRow?.tier === 'admin') {
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
    // search.list results carry no uploads-playlist position; null = fall back
    // to publishedAt ordering (search is title-relevance, not recency, anyway).
    uploadPosition: (typeof (snippet?.position) === 'number' ? (snippet.position as number) : null),
  }
}

// Scan up to MAX_PAGES, return the accumulated videos + a continuation cursor.
// When MAX_PAGES is hit with a cursor remaining, the cursor is returned so
// "Load more" can continue — we don't claim full_scan=true unless the cursor
// is actually exhausted.
const MAX_PAGES = 15
// The early-stop fires once we've found this many UNSHIPPED drafts — i.e.
// actual "To do" work. We gate on unshipped (not total) drafts because a draft
// we already pushed metadata for lands in the "Shipped" tab; counting those
// toward the quota made the scan stop on a wall of already-shipped drafts and
// never reach the user's real to-do queue ("To do" showed 0 while the work sat
// deeper in the uploads list). See support_yt_copilot_draft_discovery.
const MIN_TODO_HITS = 12

/** All YouTube video IDs the user has already pushed metadata for via Co-Pilot
 *  (youtube_copilot_pushes). Used to gate the scan's early-stop on UNSHIPPED
 *  drafts so the to-do queue is actually surfaced. Best-effort: an empty set on
 *  failure just means the scan treats every draft as to-do (its old behaviour). */
async function loadPushedIds(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('youtube_copilot_pushes')
      .select('youtube_video_id')
      .eq('user_id', userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Set((data ?? []).map((r: any) => r.youtube_video_id).filter(Boolean) as string[])
  } catch {
    return new Set<string>()
  }
}

async function runFullScanWithCursor(
  yt: ReturnType<typeof createYouTubeOAuthService>,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  cachedPlaylistId?: string,
  fromCursor?: string,
  persist = true,
): Promise<{ videos: ReturnType<typeof buildDraftVideo>[]; nextCursor?: string; uploadsPlaylistId?: string }> {
  const accumulated: ReturnType<typeof buildDraftVideo>[] = []
  // The set of videos we've already shipped metadata for — those belong in
  // "Shipped", not "To do", so they must NOT satisfy the to-do quota below.
  const pushedIds = await loadPushedIds(supabase, userId)
  // Continue from the caller's cursor (load-more) instead of restarting at the
  // top of the uploads list. undefined = fresh scan from page 1.
  let cursor: string | undefined = fromCursor
  let pagesScanned = 0
  let todoHits = 0
  let uploadsPlaylistId = cachedPlaylistId
  let hitPageLimit = false

  while (pagesScanned < MAX_PAGES) {
    const page = await yt.getDraftVideos(50, cursor, uploadsPlaylistId)
    uploadsPlaylistId = page.uploadsPlaylistId
    pagesScanned++
    for (const v of page.videos) {
      accumulated.push(v as ReturnType<typeof buildDraftVideo>)
      // A to-do item = an unpublished draft we HAVEN'T already pushed metadata
      // for. Only these count toward the early-stop, so the scan keeps digging
      // past a block of already-shipped drafts until it surfaces real work.
      if (v.status !== 'public' && !pushedIds.has(v.youtubeVideoId)) {
        todoHits++
      }
    }
    // Stop once we've surfaced enough genuine to-do drafts (after a min depth).
    if (todoHits >= MIN_TODO_HITS && pagesScanned >= 3) {
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

  // Persist what we scanned. full_scan=true only if we actually exhausted the
  // playlist. persist=false for the load-more path, which merges with the
  // existing cache and writes that itself (so the cache keeps every video, not
  // just this continuation page). Store the cursor so a later cached load can
  // still offer "Load more".
  const isFullyScanFull = !cursor && !hitPageLimit
  if (persist && uploadsPlaylistId) {
    await writeCache(supabase, userId, uploadsPlaylistId, accumulated, isFullyScanFull, cursor ?? null)
  }

  return { videos: accumulated, nextCursor: cursor, uploadsPlaylistId }
}

// Shallow top-up: fetch just the newest TOPUP_PAGES pages of the uploads list to
// catch new uploads for a few quota units, WITHOUT the deeper to-do scan. Used
// only when the cache is present but stale — the cached list already holds the
// deep back-catalog, so we just merge any brand-new uploads on top of it.
async function runTopUpScan(
  yt: ReturnType<typeof createYouTubeOAuthService>,
  cachedPlaylistId?: string,
): Promise<{ videos: ReturnType<typeof buildDraftVideo>[]; uploadsPlaylistId?: string }> {
  const acc: ReturnType<typeof buildDraftVideo>[] = []
  let cursor: string | undefined = undefined
  let uploadsPlaylistId = cachedPlaylistId
  for (let p = 0; p < TOPUP_PAGES; p++) {
    const page = await yt.getDraftVideos(50, cursor, uploadsPlaylistId)
    uploadsPlaylistId = page.uploadsPlaylistId
    for (const v of page.videos) acc.push(v as ReturnType<typeof buildDraftVideo>)
    if (!page.nextPageToken) break
    cursor = page.nextPageToken
  }
  return { videos: acc, uploadsPlaylistId }
}

// Simplified scan for search-fallback and cursor-continuation paths.
// Returns videos only (no cursor tracking needed by callers).
async function runFullScan(
  yt: ReturnType<typeof createYouTubeOAuthService>,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  cachedPlaylistId?: string,
  fromPageToken?: string,
  persist = true,
): Promise<ReturnType<typeof buildDraftVideo>[]> {
  const result = await runFullScanWithCursor(yt, supabase, userId, cachedPlaylistId, fromPageToken, persist)
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
