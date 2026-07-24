/**
 * POST /api/youtube/shorts/render
 *
 * Shorts Studio — the "factory". Takes a planned clip (a youtube_shorts row) +
 * the creator's uploaded source MP4 and renders the finished vertical Short via
 * Cloudinary: trim → 9:16 reframe → burned subtitles. The source file is
 * uploaded once (client-side, to Supabase) and reused across every clip from the
 * same video — we never server-pull the video from YouTube (YouTube ToS), the
 * same rule the Instagram burner follows.
 *
 * Body: { shortId, subtitleStyle? }
 * Returns: { ok, short } | { error, needsUpload?, videoId? }
 *
 * Pro-only. No AI cost (pure Cloudinary), so it's off the generation quota.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { cloudinaryConfigured, renderVerticalShort, getLastShortError } from '@/services/cloudinary'
import { ingestConfigured, clipSegment } from '@/lib/youtube-ingest'
import { recordUsage } from '@/lib/ai-usage'
import { rowToShort } from '@/lib/shorts-row'
import { SUBTITLE_STYLES, type SubtitleStyle, type CaptionChunk } from '@/lib/shorts-types'

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
        error: 'Rendering Shorts is a Pro feature.',
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }
    if (!cloudinaryConfigured()) {
      return NextResponse.json({ error: 'Video rendering isn\'t configured yet. Try again shortly.' }, { status: 503 })
    }

    const body = await request.json().catch(() => ({})) as { shortId?: string; subtitleStyle?: string; captions?: boolean }
    const shortId = (body.shortId || '').trim()
    // Captions default ON; captions:false renders a clean clip (no burned text).
    const withCaptions = body.captions !== false
    if (!shortId) return NextResponse.json({ error: 'shortId is required.' }, { status: 400 })
    const style: SubtitleStyle = SUBTITLE_STYLES.includes(body.subtitleStyle as SubtitleStyle)
      ? (body.subtitleStyle as SubtitleStyle) : 'bold-white'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: short } = await sb.from('youtube_shorts')
      .select('*').eq('id', shortId).eq('user_id', user.id).maybeSingle()
    if (!short) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })

    // The source MP4 the creator uploaded for this video (kept distinct from a
    // finished vertical Short in instagram_video_url).
    const { data: video } = await sb.from('youtube_videos')
      .select('id,source_video_url,cloudinary_source_id')
      .eq('id', short.video_id).eq('user_id', user.id).maybeSingle()
    const sourceUrl = (video?.source_video_url as string | null) || ''
    if (!/^https:\/\//i.test(sourceUrl)) {
      return NextResponse.json({
        error: 'Upload the source video first so we can cut this clip.',
        needsUpload: true, videoId: short.video_id,
      }, { status: 412 })
    }

    const captions = (Array.isArray(short.subtitles) ? short.subtitles : []) as CaptionChunk[]
    const startSec = Number(short.start_sec)
    const endSec = Number(short.end_sec)

    // Trim the clip first (ffmpeg on the ingest service) so Cloudinary only
    // ingests the ~15-30s segment — the whole source can exceed Cloudinary's
    // 100MB upload cap ("File size too large"). Falls back to the full source
    // when the ingest service isn't configured or trimming fails.
    const clip = ingestConfigured() ? await clipSegment(sourceUrl, startSec, endSec, user.id) : null
    const usingClip = !!clip

    const result = await renderVerticalShort({
      sourceVideoUrl: usingClip ? clip!.url : sourceUrl,
      // The trimmed clip is already the window, re-based to 0.
      startSec: usingClip ? 0 : startSec,
      endSec: usingClip ? (clip!.durationSeconds ?? (endSec - startSec)) : endSec,
      // Captions off → render a clean vertical clip (no subtitles, no hook banner).
      captions: withCaptions ? captions : [],
      style,
      hook: withCaptions ? ((short.hook as string) || '') : '',
      // Don't reuse the cached full-source asset when uploading a fresh clip.
      sourcePublicId: usingClip ? null : ((video?.cloudinary_source_id as string | null) || null),
    })

    if (!result) {
      const detail = getLastShortError() || 'unknown error'
      try {
        await sb.from('youtube_shorts')
          .update({ status: 'failed', render_error: detail, updated_at: new Date().toISOString() })
          .eq('id', shortId).eq('user_id', user.id)
      } catch { /* non-fatal */ }
      return NextResponse.json({ error: `Couldn't render the clip: ${detail}` }, { status: 500 })
    }

    // Cache the one-time Cloudinary source upload so the next clip skips it —
    // only on the full-source path (a trimmed clip is unique per clip).
    if (!usingClip && result.sourcePublicId && result.sourcePublicId !== video?.cloudinary_source_id) {
      try {
        await sb.from('youtube_videos')
          .update({ cloudinary_source_id: result.sourcePublicId })
          .eq('id', short.video_id).eq('user_id', user.id)
      } catch { /* non-fatal */ }
    }

    const { data: updated } = await sb.from('youtube_shorts')
      .update({
        status: 'rendered',
        rendered_url: result.url,
        subtitle_style: style,
        render_error: null,
        rendered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', shortId).eq('user_id', user.id)
      .select('*').maybeSingle()

    recordUsage({ userId: user.id, tier, feature: 'shorts_render', model: 'cloudinary', images: 1 })
    return NextResponse.json({ ok: true, short: updated ? rowToShort(updated) : null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[shorts/render]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
