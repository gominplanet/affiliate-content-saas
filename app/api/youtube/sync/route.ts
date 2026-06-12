import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeService } from '@/services/youtube'
import { getAuthAndOwner } from '@/lib/agency-auth'

const SYNC_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min to prevent spam while allowing fresh data

interface SyncCacheRow {
  page_token: string | null
  synced_count: number
  next_page_token: string | null
  cached_at: string
}

async function readSyncCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<SyncCacheRow | null> {
  const { data } = await (supabase as any)
    .from('youtube_sync_cache')
    .select('page_token,synced_count,next_page_token,cached_at')
    .eq('user_id', userId)
    .maybeSingle()
  return data ?? null
}

async function writeSyncCache(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  pageToken: string | null,
  syncedCount: number,
  nextPageToken: string | null,
): Promise<void> {
  await (supabase as any)
    .from('youtube_sync_cache')
    .upsert({
      user_id: userId,
      page_token: pageToken,
      synced_count: syncedCount,
      next_page_token: nextPageToken,
      cached_at: new Date().toISOString(),
    }, { onConflict: 'user_id,page_token' })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): syncing pulls the OWNER's channel videos and
  // writes them under ownerId so the Library reflects the owner's workspace
  // regardless of who triggered the sync.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'YouTube API key not configured on the server. Contact support.', code: 'no_api_key' }, { status: 400 })
  }

  // Read per-user channel ID from integrations table. Use maybeSingle so a
  // missing integrations row (rare but possible right after signup) doesn't
  // throw the silent .single() error that the empty-catch on the client
  // then swallows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('youtube_channel_id')
    .eq('user_id', ownerId)
    .maybeSingle()

  // SECURITY (2026-06-12 cross-tenant leak fix): the channel is PER-USER only.
  // The previous `|| process.env.YOUTUBE_CHANNEL_ID` fallback meant ANY account
  // that hadn't set its own channel id synced the FOUNDER's channel (the env
  // value) and wrote those videos under that user's user_id — so the founder's
  // YouTube videos appeared in random users' Library + Co-Pilot. There is NO
  // shared fallback: an account with no channel set gets the clear error below
  // and syncs nothing. (Reads were always user-scoped; the leak was this write.)
  const channelId = intRow?.youtube_channel_id || null
  if (!channelId) {
    return NextResponse.json({
      error: 'No YouTube channel ID set on your account yet. Open Blog Set Up → Integrations and paste your YouTube channel ID, then try Sync again.',
      code: 'no_channel_id',
    }, { status: 400 })
  }

  let pageToken: string | undefined
  try {
    const body = await request.json().catch(() => ({}))
    pageToken = body.pageToken || undefined
  } catch { /* no body */ }

  try {
    // Check cache for this page (only when no pageToken — first page)
    if (!pageToken) {
      const cached = await readSyncCache(supabase, ownerId)
      if (cached) {
        const cacheAge = Date.now() - new Date(cached.cached_at).getTime()
        if (cacheAge < SYNC_CACHE_TTL_MS) {
          // Cache fresh — return it (0 units)
          return NextResponse.json({
            synced: cached.synced_count,
            nextPageToken: cached.next_page_token ?? null,
            channelId,
            fromCache: true,
          })
        }
      }
    }

    const youtube = createYouTubeService(apiKey)
    const { videos, nextPageToken } = await youtube.getChannelVideos(channelId, 50, pageToken)

    if (videos.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No videos found', nextPageToken: null })
    }

    const rows = videos.map((v) => ({
      user_id: ownerId,
      youtube_video_id: v.youtubeVideoId,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnailUrl,
      channel_id: v.channelId,
      channel_title: v.channelTitle,
      published_at: v.publishedAt,
      view_count: v.viewCount,
      duration_seconds: v.durationSeconds,
      is_vertical: v.isVertical,
    }))

    // Detect truly new videos (not already in DB) before upsert
    const incomingIds = videos.map(v => v.youtubeVideoId)
    const { data: existing } = await supabase
      .from('youtube_videos')
      .select('youtube_video_id')
      .eq('user_id', ownerId)
      .in('youtube_video_id', incomingIds)
    const existingIds = new Set((existing ?? []).map((r: { youtube_video_id: string }) => r.youtube_video_id))
    const newVideos = videos.filter(v => !existingIds.has(v.youtubeVideoId))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('youtube_videos')
      .upsert(rows, { onConflict: 'user_id,youtube_video_id' })

    if (error) throw error

    // Cache this page's results to prevent repeated API calls (5 min TTL)
    if (!pageToken) {
      try {
        await writeSyncCache(supabase, ownerId, null, videos.length, nextPageToken ?? null)
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ synced: videos.length, newCount: newVideos.length, nextPageToken: nextPageToken ?? null, channelId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Surface a stable error code when the YouTube API itself rejected us
    // (bad channel id, quota exhausted, key revoked). Lets the client show
    // a more useful nudge than the raw API error string.
    const lower = message.toLowerCase()
    const code = lower.includes('quota') ? 'youtube_quota'
      : lower.includes('not found') || lower.includes('channelnotfound') ? 'channel_not_found'
      : lower.includes('forbidden') || lower.includes('keyinvalid') ? 'api_key_bad'
      : 'youtube_error'
    return NextResponse.json({ error: message, code, channelId }, { status: 500 })
  }
}
