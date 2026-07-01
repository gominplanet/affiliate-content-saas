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
import { createYouTubeOAuthService } from '@/services/youtube'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { tierAllowsPublishAll, type Tier } from '@/lib/tier'
import { resolveThumbnailInput } from '@/lib/youtube-thumbnail-input'
import { bustYouTubeCache } from '@/app/api/youtube/drafts/route'

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
    // Resolve the OAuth token for the channel THIS video belongs to (migration
    // 127 multi-channel). getChannelOAuthToken refreshes + persists the token,
    // and falls back to the legacy integrations token for the default channel —
    // so single-channel users are unaffected, and a Pro user can push to a
    // secondary channel's video using that channel's own token.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vidRow } = await (supabase as any)
      .from('youtube_videos')
      .select('channel_id')
      .eq('user_id', user.id)
      .eq('youtube_video_id', body.videoId)
      .maybeSingle()
    const token = await getChannelOAuthToken(supabase, user.id, vidRow?.channel_id ?? null)
    if (!token) {
      return NextResponse.json({ error: 'That video’s YouTube channel isn’t connected. Reconnect it under Set Up → YouTube and try again.' }, { status: 400 })
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
    // hiccup here shouldn't fail the user's request.
    //
    // 2026-06-08: write goes to youtube_copilot_pushes (migration 109)
    // NOT youtube_videos. Earlier attempt wrote to youtube_videos but that
    // table has NOT NULL channel_id/channel_title/title/published_at which
    // aren't populated until /api/youtube/sync runs — so for Co-Pilot
    // users who never sync, the INSERT silently failed and the
    // "Pushed via Co-Pilot" tab always showed 0. The dedicated table has
    // only the fields we need.
    if (results[0].status === 'fulfilled') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('youtube_copilot_pushes')
          .upsert({
            user_id: user.id,
            youtube_video_id: body.videoId,
            pushed_at: new Date().toISOString(),
          }, { onConflict: 'user_id,youtube_video_id' })
      } catch (err) {
        console.warn('[yt-apply] failed to record copilot push:', err instanceof Error ? err.message : String(err))
      }
      // Bust the video cache so the next Co-Pilot load reflects the pushed
      // video's new title/status/thumbnail rather than serving stale data.
      try { await bustYouTubeCache(supabase, user.id) } catch { /* non-fatal */ }
    }

    // statusOk reflects whether the videos.update STATUS call (the one that sets
    // privacy / publishAt — i.e. what actually schedules or publishes the video)
    // succeeded. The UI gates its "Scheduled / Applied" success state on this so
    // it can't show green when every write 403'd on quota. quotaHit lets the UI
    // render a friendly "quota's used up, try after it resets" message instead of
    // the raw 403 JSON.
    const statusOk = results[1].status === 'fulfilled'
    const quotaHit = warnings.some((w) => /quotaExceeded|exceeded your/i.test(w))
    return NextResponse.json({ ok: warnings.length === 0, warnings, statusOk, quotaHit })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
