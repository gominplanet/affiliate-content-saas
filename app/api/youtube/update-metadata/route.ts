import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { resolveThumbnailInput } from '@/lib/youtube-thumbnail-input'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { videoId, title, description, tags, thumbnailDataUri } = await request.json() as {
      videoId: string
      title: string
      description: string
      tags: string[]
      thumbnailDataUri?: string
    }

    // Resolve the token for the channel THIS video belongs to (migration 127
    // multi-channel). Refreshes + persists; falls back to the legacy default
    // channel token, so single-channel users are unaffected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vidRow } = await (supabase as any)
      .from('youtube_videos')
      .select('channel_id')
      .eq('user_id', user.id)
      .eq('youtube_video_id', videoId)
      .maybeSingle()
    const token = await getChannelOAuthToken(supabase, user.id, vidRow?.channel_id ?? null)
    if (!token) {
      return NextResponse.json({ error: 'That video’s YouTube channel isn’t connected. Reconnect it under Set Up → YouTube and try again.' }, { status: 400 })
    }

    const yt = createYouTubeOAuthService(token)

    // Run metadata update + thumbnail upload in parallel when thumbnail provided
    const tasks: Promise<void>[] = [
      yt.updateVideoMetadata(videoId, { title, description, tags }),
    ]

    // Normalize the thumbnail input — supports both `data:image/...`
    // URIs (uploaded files) and HTTPS URLs (AI-generated thumbnails
    // hosted on fal/Supabase). Until 2026-06-07 the regex-only path
    // silently skipped HTTPS URLs, which is why generated thumbnails
    // never landed on YouTube.
    if (thumbnailDataUri) {
      tasks.push((async () => {
        const resolved = await resolveThumbnailInput(thumbnailDataUri)
        if (!resolved) {
          throw new Error(`Thumbnail input wasn't a data URI or HTTPS URL: ${thumbnailDataUri.slice(0, 80)}`)
        }
        await yt.uploadThumbnail(videoId, resolved.buffer, resolved.mimeType)
      })())
    }

    const results = await Promise.allSettled(tasks)
    const thumbResult = results[1]
    const thumbWarning = thumbResult?.status === 'rejected'
      ? (thumbResult.reason instanceof Error ? thumbResult.reason.message : 'Thumbnail upload failed')
      : null

    // Record push for the YouTube Co-Pilot "🚀 Pushed via Co-Pilot" tab.
    // Only on metadata-update success (results[0]) — a failed thumbnail
    // upload still counts since the title/description landed.
    //
    // 2026-06-08: writes to youtube_copilot_pushes (migration 109), NOT
    // youtube_videos. The earlier attempt wrote to youtube_videos but that
    // table has NOT NULL columns that aren't populated until /api/youtube/sync
    // runs, so the INSERT silently failed for users who never sync.
    if (results[0].status === 'fulfilled') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('youtube_copilot_pushes')
          .upsert({
            user_id: user.id,
            youtube_video_id: videoId,
            pushed_at: new Date().toISOString(),
          }, { onConflict: 'user_id,youtube_video_id' })
      } catch (err) {
        console.warn('[yt-update-metadata] failed to record copilot push:', err instanceof Error ? err.message : String(err))
      }
    }

    return NextResponse.json({ ok: true, ...(thumbWarning ? { thumbnailWarning: thumbWarning } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[update-metadata]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
