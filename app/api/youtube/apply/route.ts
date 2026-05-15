/**
 * POST /api/youtube/apply
 *
 * Pro-only "Apply to YouTube" batch endpoint. Pushes everything a creator
 * normally toggles in YouTube Studio after generation, in one shot:
 *
 *   - Updates title, description, tags (and optionally thumbnail)
 *   - Sets madeForKids, paidPromotion, alteredContent flags
 *   - Schedules the video for `publishAt` (ISO 8601) or publishes
 *     immediately as `privacyStatus` (public/unlisted/private)
 *   - Suppresses subscriber notifications via the notifySubscribers
 *     query param
 *   - Adds the video to a playlist (if `playlistId` provided)
 *
 * Things YouTube does NOT expose to apps (we can't automate, surface in
 * the UI for manual paste):
 *   - End-screens
 *   - Pinned comments (we can post a comment, can't pin it)
 *   - The full advertiser-friendly questionnaire — only some fields
 *     are settable via the API
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  createYouTubeOAuthService,
  getValidYouTubeToken,
} from '@/services/youtube'
import { tierAllowsPublishAll, type Tier } from '@/lib/tier'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as {
      videoId: string
      title?: string
      description?: string
      tags?: string[]
      thumbnailDataUri?: string
      playlistId?: string | null
      madeForKids?: boolean
      paidPromotion?: boolean
      alteredContent?: boolean
      notifySubscribers?: boolean
      /** ISO 8601 timestamp. When set, video is scheduled (private until then). */
      publishAt?: string | null
      privacyStatus?: 'public' | 'unlisted' | 'private'
    }
    if (!body.videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('tier,youtube_oauth_access_token,youtube_oauth_refresh_token,youtube_oauth_token_expiry')
      .eq('user_id', user.id)
      .single()
    const intData = (intRow as Record<string, unknown> | null) ?? {}
    const tier = (intData.tier as Tier) ?? 'free'
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
      await (supabase as any)
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
    if (body.thumbnailDataUri) {
      const m = body.thumbnailDataUri.match(/^data:([^;]+);base64,(.+)$/)
      if (m) {
        const buf = Buffer.from(m[2], 'base64')
        tasks.push(yt.uploadThumbnail(body.videoId, buf, m[1]))
      }
    }

    // 2. Status update (privacy, made-for-kids, paid promotion, altered
    //    content, schedule / notifySubscribers). Run AFTER snippet update
    //    so a videos.list race can't read stale state if YT replicates.
    const statusUpdate = yt.updateVideoStatus(body.videoId, {
      madeForKids: body.madeForKids,
      paidPromotion: body.paidPromotion,
      alteredContent: body.alteredContent,
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

    return NextResponse.json({ ok: warnings.length === 0, warnings })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
