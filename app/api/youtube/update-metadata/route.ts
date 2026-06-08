import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createYouTubeOAuthService, getValidYouTubeToken } from '@/services/youtube'
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()

    const intData = intRow as Record<string, unknown>
    const expiry = intData.youtube_oauth_token_expiry as number | null
    const needsRefresh = expiry && Date.now() > expiry - 120_000

    const token = await getValidYouTubeToken(intData)

    // Persist refreshed token so it stays valid for future calls
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

    return NextResponse.json({ ok: true, ...(thumbWarning ? { thumbnailWarning: thumbWarning } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[update-metadata]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
