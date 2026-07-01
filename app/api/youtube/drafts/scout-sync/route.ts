import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * POST /api/youtube/drafts/scout-sync
 *
 * SCOUT (the browser extension) reads the user's ENTIRE YouTube Studio video
 * library from Studio's own internal endpoint — free of the YouTube Data API
 * daily quota (it runs in the user's logged-in Studio session, not our OAuth
 * project). The client posts that list here and we write it straight into the
 * same `youtube_video_cache` that `GET /api/youtube/drafts` already serves from.
 *
 * Net effect: the Co-Pilot draft list renders with ZERO YouTube Data API units.
 * This route makes NO YouTube calls — it's a pure DB write. `full_scan=true`
 * and no cursor because SCOUT returns the whole library at once, so "Load more"
 * isn't needed. Only ever writes the caller's OWN cache (keyed by auth user_id).
 */

interface ScoutVideoIn {
  videoId?: string
  title?: string
  status?: string
  publishedAt?: string
  publishAt?: string | null
  thumbnailUrl?: string
}

// Same ASIN detector the drafts scan uses — title carries the product code.
function detectAsin(title: string): string | null {
  const m = title.match(/\b([A-Z0-9]{10})\b/)
  return m ? m[1] : null
}

const ALLOWED_STATUS = new Set(['public', 'unlisted', 'private'])
const MAX_VIDEOS = 5000

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = (await request.json()) as { videos?: ScoutVideoIn[] }
    const raw = Array.isArray(body.videos) ? body.videos : []
    if (raw.length === 0) return NextResponse.json({ error: 'no videos' }, { status: 400 })

    // Map SCOUT's list → the cache's video shape (matches buildDraftVideo in the
    // drafts route). Dedup by id, clamp fields, cap size.
    const seen = new Set<string>()
    const videos: Array<Record<string, unknown>> = []
    for (let i = 0; i < raw.length && videos.length < MAX_VIDEOS; i++) {
      const v = raw[i]
      const id = typeof v.videoId === 'string' ? v.videoId.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      const title = typeof v.title === 'string' ? v.title.slice(0, 300) : ''
      const status = typeof v.status === 'string' && ALLOWED_STATUS.has(v.status) ? v.status : 'private'
      videos.push({
        youtubeVideoId: id,
        title,
        description: '', // SCOUT's list view has no description; generation fetches it later
        thumbnailUrl:
          typeof v.thumbnailUrl === 'string' && v.thumbnailUrl
            ? v.thumbnailUrl.slice(0, 500)
            : `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        status,
        publishedAt: typeof v.publishedAt === 'string' ? v.publishedAt : '',
        publishAt: typeof v.publishAt === 'string' && v.publishAt ? v.publishAt : null,
        detectedAsin: detectAsin(title),
        // Studio returns newest-first; preserve that order for byNewestUpload.
        uploadPosition: i,
      })
    }
    if (videos.length === 0) return NextResponse.json({ error: 'no valid videos' }, { status: 400 })

    // Preserve any existing uploads_playlist_id so a later forced Data API
    // refresh still resolves the right playlist. Best-effort.
    let uploadsPlaylistId = ''
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('youtube_video_cache')
        .select('uploads_playlist_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (data?.uploads_playlist_id) uploadsPlaylistId = data.uploads_playlist_id
    } catch {
      /* ignore — first-ever sync has no row yet */
    }

    // full_scan=true (SCOUT returns the whole library). cached_at=now so the
    // drafts GET treats it as fresh and serves it outright — 0 Data API units.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('youtube_video_cache')
      .upsert(
        {
          user_id: user.id,
          uploads_playlist_id: uploadsPlaylistId,
          videos,
          video_count: videos.length,
          cached_at: new Date().toISOString(),
          full_scan: true,
        },
        { onConflict: 'user_id' },
      )
    // Clear any stale continuation cursor (SCOUT gave us everything, so "Load
    // more" should be hidden). Separate update so a pre-migration DB without the
    // column can't break the primary write above.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('youtube_video_cache')
        .update({ next_cursor: null })
        .eq('user_id', user.id)
    } catch {
      /* column not migrated yet → ignore */
    }

    return NextResponse.json({ ok: true, count: videos.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
