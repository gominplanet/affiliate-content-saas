/**
 * POST /api/youtube/shorts/ingest — the "no upload" path.
 *
 * Given a youtube_videos row, ask the downloader service (ingest-service/) to
 * fetch the video from YouTube, host the MP4, and store it — so nobody ever has
 * to download from YouTube Studio and re-upload. Two targets:
 *   - target 'source' (default): store on source_video_url — the long-form file
 *     Find Shorts (transcribe) + Render cut clips from (vidIQ "select → clips").
 *   - target 'short': store on instagram_video_url — a finished vertical Short
 *     that lacks a stored MP4, so the burner / Enhance can use it directly.
 *
 * Body: { videoId, target? }  →  { ok, sourceReady, videoUrl? } | { error, ingestDisabled? }
 *
 * Pro-only. Entirely gated on YOUTUBE_INGEST_URL — returns a clear 501 when the
 * downloader isn't configured, so the client falls back to the upload prompt.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { ingestConfigured, ingestYouTubeVideo } from '@/lib/youtube-ingest'
import { recordUsage } from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Shorts Studio is a Pro feature.',
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }
    if (!ingestConfigured()) {
      return NextResponse.json({
        error: "Automatic fetch isn't set up on this deployment — upload the video instead.",
        ingestDisabled: true,
      }, { status: 501 })
    }

    const { videoId, target } = await request.json().catch(() => ({})) as { videoId?: string; target?: string }
    const id = (videoId || '').trim()
    if (!id) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })
    // 'short' stores a finished vertical clip on instagram_video_url; anything
    // else defaults to the long-form source on source_video_url.
    const asShort = target === 'short'
    const column = asShort ? 'instagram_video_url' : 'source_video_url'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: video } = await sb.from('youtube_videos')
      .select('id,youtube_video_id,source_video_url,instagram_video_url')
      .eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

    // Already have the file — nothing to fetch.
    const existing = (video[column] as string | null) || ''
    if (/^https:\/\//i.test(existing)) {
      return NextResponse.json({ ok: true, sourceReady: true, alreadyHad: true, videoUrl: existing })
    }

    const ytId = (video.youtube_video_id as string | null) || ''
    if (!ytId) return NextResponse.json({ error: 'This video has no YouTube id to fetch.' }, { status: 400 })

    const result = await ingestYouTubeVideo(ytId, user.id)
    if (!result) {
      return NextResponse.json({
        error: "We couldn't fetch this video automatically. Upload the MP4 instead and we'll take it from there.",
        needsUpload: true,
      }, { status: 502 })
    }

    try {
      await sb.from('youtube_videos').update(
        asShort
          ? { instagram_video_url: result.url }
          : {
              source_video_url: result.url,
              source_video_uploaded_at: new Date().toISOString(),
              ...(result.durationSeconds ? { duration_seconds: result.durationSeconds } : {}),
            },
      ).eq('id', id).eq('user_id', user.id)
    } catch { /* the URL is still returned; a failed cache write isn't fatal */ }

    recordUsage({ userId: user.id, tier, feature: 'shorts_ingest', model: 'youtube-ingest', images: 1 })
    return NextResponse.json({ ok: true, sourceReady: true, videoUrl: result.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[shorts/ingest]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
