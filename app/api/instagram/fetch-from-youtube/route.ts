/**
 * POST /api/instagram/fetch-from-youtube
 *
 * Resolves a YouTube URL into an MP4, downloads it via RapidAPI, and
 * uploads the file to Supabase Storage bucket `instagram-videos`.
 * Saves the resulting public URL to `youtube_videos.instagram_video_url`.
 *
 * Body:
 *   { youtubeUrl: string, videoDbId: string }
 *
 * Tier: Pro-only (Instagram is Pro).
 *
 * Returns:
 *   { ok: true, instagramVideoUrl, durationSeconds, width, height }
 *
 * Failure modes worth flagging in the UI:
 *   - 'video_too_large' — MP4 > 100MB; user has to upload manually
 *   - 'no_mp4_format'   — RapidAPI returned no usable MP4 (rare; usually
 *                          age-restricted or DRM'd videos)
 *   - 'rapidapi_failed' — upstream service errored / rate-limited
 *   - 'not_vertical'    — picked format isn't 9:16; we still save it but
 *                          warn the user (some short-form vids are square)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVideoDetails, pickBestFormatForInstagram, downloadMp4 } from '@/services/youtube-download'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as { youtubeUrl?: string; videoDbId?: string }
    const youtubeUrl = body.youtubeUrl?.trim()
    const videoDbId = body.videoDbId
    if (!youtubeUrl) return NextResponse.json({ error: 'youtubeUrl required' }, { status: 400 })
    if (!videoDbId) return NextResponse.json({ error: 'videoDbId required' }, { status: 400 })

    // Tier gate — Instagram is Pro
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'instagram')) {
      return NextResponse.json(
        { error: 'Fetching YouTube videos for Instagram is a Pro feature. Upgrade to Pro to enable this.' },
        { status: 403 },
      )
    }

    // Resolve the YouTube URL → details + format list
    let details
    try {
      details = await getVideoDetails(youtubeUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg, code: 'rapidapi_failed' }, { status: 502 })
    }

    const chosen = pickBestFormatForInstagram(details.formats)
    if (!chosen) {
      return NextResponse.json(
        { error: 'No MP4 format available for this video (may be age-restricted, private, or DRM-protected).', code: 'no_mp4_format' },
        { status: 422 },
      )
    }

    // Download the MP4 bytes
    let buffer: ArrayBuffer
    try {
      buffer = await downloadMp4(chosen.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg, code: 'video_too_large' }, { status: 413 })
    }

    // Upload to Supabase Storage using the admin client (so RLS doesn't
    // need to be configured for direct service-role uploads).
    const admin = createAdminClient()
    const path = `${user.id}/${videoDbId}.mp4`
    const { error: upErr } = await admin.storage
      .from('instagram-videos')
      .upload(path, buffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'video/mp4',
      })
    if (upErr) {
      return NextResponse.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 500 })
    }

    const { data: urlData } = admin.storage.from('instagram-videos').getPublicUrl(path)
    const publicUrl = urlData.publicUrl

    // Persist on youtube_videos so the IG publish route can find it.
    // Use admin to bypass RLS — the row is the user's own anyway, verified
    // via the user_id match we apply here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (admin as any)
      .from('youtube_videos')
      .update({ instagram_video_url: publicUrl })
      .eq('id', videoDbId)
      .eq('user_id', user.id)
    if (updateErr) {
      return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      instagramVideoUrl: publicUrl,
      durationSeconds: details.durationSeconds,
      width: chosen.width,
      height: chosen.height,
      isVertical: chosen.width && chosen.height ? chosen.height > chosen.width : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
