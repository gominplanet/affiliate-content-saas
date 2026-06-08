/**
 * POST /api/youtube/apply
 *
 * Pro-only "Apply to YouTube" batch endpoint. Pushes everything a creator
 * normally toggles in YouTube Studio after generation, in one shot:
 *
 *   - Updates title, description, tags (and optionally thumbnail)
 *   - Sets madeForKids flag
 *   - Schedules the video for `publishAt` (ISO 8601) or publishes
 *     immediately as `privacyStatus` (public/unlisted/private)
 *   - Suppresses subscriber notifications via the notifySubscribers
 *     query param
 *   - Adds the video to a playlist (if `playlistId` provided)
 *
 * Things YouTube does NOT expose to apps (surface in the UI as a
 * post-apply "Finish in Studio (3 clicks)" checklist instead):
 *   - Paid promotion disclosure (containsPaidPromotion is read-only via API)
 *   - Monetization access policy (only available with youtubepartner scope,
 *     which Google doesn't grant to general third-party tools)
 *   - The advertiser-friendly content rating questionnaire — Studio-only
 *   - End-screens
 *   - Pinned comments (we can post a comment, can't pin it)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  createYouTubeOAuthService,
  getValidYouTubeToken,
} from '@/services/youtube'
import { tierAllowsPublishAll, type Tier } from '@/lib/tier'
import { resolveThumbnailInput } from '@/lib/youtube-thumbnail-input'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Note: paidPromotion, alteredContent, monetization, and content-rating
    // questionnaire fields are intentionally NOT in this signature. YouTube's
    // Data API doesn't accept them. The Studio panel surfaces them as a
    // post-apply "Finish in Studio (3 clicks)" callout instead.
    const body = await request.json() as {
      videoId: string
      title?: string
      description?: string
      tags?: string[]
      thumbnailDataUri?: string
      playlistId?: string | null
      madeForKids?: boolean
      notifySubscribers?: boolean
      /** ISO 8601 timestamp. When set, video is scheduled (private until then). */
      publishAt?: string | null
      privacyStatus?: 'public' | 'unlisted' | 'private'
    }
    if (!body.videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()
    const intData = (intRow as Record<string, unknown> | null) ?? {}
    const tier = (intData.tier as Tier) ?? 'trial'
    if (!tierAllowsPublishAll(tier)) {
      return NextResponse.json(
        { error: 'One-click YouTube apply is a Pro plan feature. Upgrade to Pro to unlock it.' },
        { status: 403 },
      )
    }
    if (!intData.youtube_oauth_access_token) {
      return NextResponse.json({ error: 'YouTube not connected.' }, { status: 400 })
    }

    const expiry = intData.youtube_oauth_token_expiry as number | null
    const needsRefresh = !!expiry && Date.now() > expiry - 120_000
    const token = await getValidYouTubeToken(intData)

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

    // 1. Snippet update (title / description / tags) + thumbnail in parallel.
    //    Same path the existing /api/youtube/update-metadata uses.
    const tasks: Array<Promise<void>> = []
    if (body.title && body.description && body.tags) {
      tasks.push(
        yt.updateVideoMetadata(body.videoId, {
          title: body.title,
          description: body.description,
          tags: body.tags,
        }),
      )
    }
    // Normalize the thumbnail input via the shared resolver — handles
    // both `data:image/...;base64,...` URIs (user-uploaded files) AND
    // `https://...` URLs (AI-generated thumbnails uploaded to fal/
    // Supabase Storage). Until 2026-06-07 this regex-matched only data
    // URIs and silently skipped HTTPS URLs — the user reported their
    // generated thumbnail never landed on YouTube. The resolver throws
    // on a recognized-but-broken URL (fetch failure, oversized) so the
    // warning surfaces; null = unrecognized format, warn separately.
    if (body.thumbnailDataUri) {
      const userInput = body.thumbnailDataUri  // closure-capture so the catch sees it
      tasks.push((async () => {
        const resolved = await resolveThumbnailInput(userInput)
        if (!resolved) {
          throw new Error(`Thumbnail input wasn't a data URI or HTTPS URL: ${userInput.slice(0, 80)}`)
        }
        await yt.uploadThumbnail(body.videoId, resolved.buffer, resolved.mimeType)
      })())
    }

    // 2. Status update (privacy, made-for-kids, paid promotion, altered
    //    content, schedule / notifySubscribers). Run AFTER snippet update
    //    so a videos.list race can't read stale state if YT replicates.
    const statusUpdate = yt.updateVideoStatus(body.videoId, {
      madeForKids: body.madeForKids,
      privacyStatus: body.privacyStatus,
      publishAt: body.publishAt ?? null,
      notifySubscribers: body.notifySubscribers,
    })

    // 3. Playlist add — independent, run in parallel with status.
    const playlistTask = body.playlistId
      ? yt.addVideoToPlaylist(body.playlistId, body.videoId)
      : Promise.resolve()

    const results = await Promise.allSettled([
      Promise.allSettled(tasks),
      statusUpdate,
      playlistTask,
    ])

    const warnings: string[] = []
    // Drill into the metadata/thumbnail bundle for any individual failure.
    if (results[0].status === 'fulfilled') {
      for (const r of (results[0] as PromiseFulfilledResult<PromiseSettledResult<void>[]>).value) {
        if (r.status === 'rejected') {
          warnings.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
        }
      }
    } else {
      warnings.push((results[0] as PromiseRejectedResult).reason instanceof Error
        ? ((results[0] as PromiseRejectedResult).reason as Error).message
        : String((results[0] as PromiseRejectedResult).reason))
    }
    if (results[1].status === 'rejected') {
      warnings.push('Status update failed: ' + (results[1].reason instanceof Error ? results[1].reason.message : String(results[1].reason)))
    }
    if (results[2].status === 'rejected') {
      warnings.push('Playlist add failed: ' + (results[2].reason instanceof Error ? results[2].reason.message : String(results[2].reason)))
    }

    // Record that we successfully pushed metadata for this video. Powers
    // the "🚀 Pushed via Co-Pilot" tab on the YouTube Co-Pilot page so the
    // user can see which videos they've already shipped through our system.
    // Best-effort: even if the metadata update succeeded on YouTube, a DB
    // hiccup here shouldn't fail the user's request — they just won't see
    // the badge until they reapply.
    if (results[0].status === 'fulfilled') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('youtube_videos')
          .upsert({
            user_id: user.id,
            youtube_video_id: body.videoId,
            youtube_metadata_applied_at: new Date().toISOString(),
          }, { onConflict: 'user_id,youtube_video_id' })
      } catch (err) {
        console.warn('[yt-apply] failed to record applied_at:', err instanceof Error ? err.message : String(err))
      }
    }

    return NextResponse.json({ ok: warnings.length === 0, warnings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
