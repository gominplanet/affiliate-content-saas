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
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, billingWindow, type Tier } from '@/lib/tier'
import { cloudinaryConfigured, renderVerticalShort, getLastShortError } from '@/services/cloudinary'
import { ingestConfigured, clipSegment, renderShort, renderShortSegment, ingestYouTubeVideo, getLastIngestError } from '@/lib/youtube-ingest'
import { buildCaptionChunks, isPowerWord } from '@/lib/shorts-captions'
import { recordUsage } from '@/lib/ai-usage'
import { rowToShort } from '@/lib/shorts-row'
import { storagePathFromPublicUrl } from '@/lib/storage-url'
import { SHORTS_MONTHLY_CAP } from '@/lib/usage-cap'
import { SUBTITLE_STYLES, type SubtitleStyle, type CaptionChunk } from '@/lib/shorts-types'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // The monthly cap is claimed atomically up front (a reservation row) and
  // refunded here if the render doesn't finish — so a failed/aborted render
  // never burns the user's quota. See the finally block.
  let reservationId: string | null = null
  let renderSucceeded = false
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,subscription_period_start,subscription_period_end')
      .eq('user_id', user.id).single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Rendering Shorts is a Pro feature.',
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    // Monthly cap on finished Shorts (admin = unlimited), claimed ATOMICALLY so
    // concurrent renders can't slip past it. The RPC locks per-user, counts, and
    // (if under cap) inserts a zero-cost reservation row it returns; we refund it
    // in the finally if the render fails. Real render cost is logged separately
    // as 'shorts_render_cost' so it never double-counts the cap.
    const capLimit = tier === 'admin' ? null : SHORTS_MONTHLY_CAP
    const { startISO, resetLabel } = billingWindow({
      periodStart: (intRow?.subscription_period_start as string | null) ?? null,
      periodEnd: (intRow?.subscription_period_end as string | null) ?? null,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claimed, error: claimErr } = await (supabase as any)
      .rpc('claim_shorts_render', { p_cap: capLimit, p_since: startISO, p_tier: tier })
    if (claimErr) {
      // A telemetry/claim hiccup must never hard-block a paid render — fall
      // through uncapped (matches the old fail-open) and log it.
      console.error('[shorts/render] claim', claimErr.message)
    } else if (claimed === null) {
      return NextResponse.json({
        error: `You've rendered all ${capLimit} Shorts for this billing period. Resets ${resetLabel}.`,
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
      }, { status: 429 })
    } else {
      reservationId = claimed as string
    }
    // Need at least one render engine: the FFmpeg service (primary, animated
    // captions) or Cloudinary (fallback, static captions).
    if (!ingestConfigured() && !cloudinaryConfigured()) {
      return NextResponse.json({ error: 'Video rendering isn\'t configured yet. Try again shortly.' }, { status: 503 })
    }

    const body = await request.json().catch(() => ({})) as { shortId?: string; subtitleStyle?: string; captions?: boolean; reframe?: string }
    const shortId = (body.shortId || '').trim()
    // Captions default ON; captions:false renders a clean clip (no burned text).
    const withCaptions = body.captions !== false
    if (!shortId) return NextResponse.json({ error: 'shortId is required.' }, { status: 400 })
    const style: SubtitleStyle = SUBTITLE_STYLES.includes(body.subtitleStyle as SubtitleStyle)
      ? (body.subtitleStyle as SubtitleStyle) : 'bold-white'
    // Layout (ingest service handles it; older builds ignore it).
    const renderOpts = {
      reframe: body.reframe === 'split' ? 'split' as const : 'center' as const,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: short } = await sb.from('youtube_shorts')
      .select('*').eq('id', shortId).eq('user_id', user.id).maybeSingle()
    if (!short) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 })

    // Two ways to render: (a) a source MP4 the creator uploaded, or (b) fetch
    // ONLY this clip's window from YouTube (bandwidth-saving segment download).
    const { data: video } = await sb.from('youtube_videos')
      .select('id,source_video_url,cloudinary_source_id,youtube_video_id,duration_seconds')
      .eq('id', short.video_id).eq('user_id', user.id).maybeSingle()
    let sourceUrl = (video?.source_video_url as string | null) || ''
    let hasSource = /^https:\/\//i.test(sourceUrl)
    const ytId = (short.youtube_video_id as string | null) || (video?.youtube_video_id as string | null) || ''
    const canSegment = /^[A-Za-z0-9_-]{11}$/.test(ytId) && ingestConfigured()
    if (!hasSource && !canSegment) {
      return NextResponse.json({
        error: 'Upload the source video first so we can cut this clip.',
        needsUpload: true, videoId: short.video_id,
      }, { status: 412 })
    }

    // Cues are stored WORD-level (one entry per spoken word, clip-relative) so
    // the caption engine can animate word-by-word.
    const rawCues = (Array.isArray(short.subtitles) ? short.subtitles : []) as CaptionChunk[]
    // Flag "power words" (numbers, $/%, shouted or high-emphasis terms) so the
    // render service can accent-color them in the burned captions — the visual
    // that makes Hormozi/Opus-style captions pop. Backward-compatible: an older
    // render build ignores the extra `hl` field.
    const cuesWithHl = rawCues.map(c => ({ ...c, hl: isPowerWord(c.text) }))
    const startSec = Number(short.start_sec)
    const endSec = Number(short.end_sec)

    let renderedUrl: string | null = null
    let engine = 'ffmpeg-ass'

    // PRIMARY: FFmpeg + libass on the ingest service — trim + reframe to 9:16 +
    // burn Hormozi word-by-word captions in one pass. Cloudinary can't animate
    // text, so this is what makes the captions look pro.
    if (ingestConfigured()) {
      if (hasSource) {
        const r = await renderShort(sourceUrl, startSec, endSec, withCaptions ? cuesWithHl : [], user.id, style, renderOpts)
        if (r?.url) renderedUrl = r.url
      } else {
        // (a) PRIORITIZE the reliable proxy download (the same yt-dlp +
        //     residential-proxy + PO-token path Clip Factory uses via /ingest).
        //     Downloading the whole video once and caching it on the video row is
        //     both the robust option AND the efficient one for Shorts Studio,
        //     where you cut several clips from one video — every other clip then
        //     renders instantly with no YouTube fetch at all. Skipped for very
        //     long videos (>30 min) where a full download would be wasteful; those
        //     use the on-the-fly segment fetch below instead.
        const durationSec = Number(video?.duration_seconds) || 0
        const withinIngestCap = durationSec === 0 || durationSec <= 1800 // ≤30 min
        if (withinIngestCap) {
          const ing = await ingestYouTubeVideo(ytId, user.id)
          if (ing?.url) {
            sourceUrl = ing.url
            hasSource = true
            try {
              await sb.from('youtube_videos').update({
                source_video_url: ing.url,
                source_video_uploaded_at: new Date().toISOString(),
                ...(ing.durationSeconds ? { duration_seconds: ing.durationSeconds } : {}),
              }).eq('id', short.video_id).eq('user_id', user.id)
            } catch { /* the URL still works this render; a failed cache write isn't fatal */ }
            const r = await renderShort(sourceUrl, startSec, endSec, withCaptions ? cuesWithHl : [], user.id, style, renderOpts)
            if (r?.url) renderedUrl = r.url
          }
        }

        // (b) Fallback: on-the-fly segment fetch — for videos too long to fully
        //     download, or if the proxy download itself failed. Cheap but the
        //     less reliable path (YouTube blocks it more often).
        if (!renderedUrl) {
          const seg = await renderShortSegment(ytId, startSec, endSec, withCaptions ? cuesWithHl : [], user.id, style, renderOpts)
          if (seg?.url) renderedUrl = seg.url
        }
      }
    }

    // FALLBACK: Cloudinary (static captions) — only possible with a hosted
    // source URL (no segment support). Skipped on the fetch/segment path.
    if (!renderedUrl && hasSource) {
      engine = 'cloudinary'
      const clip = ingestConfigured() ? await clipSegment(sourceUrl, startSec, endSec, user.id) : null
      const usingClip = !!clip
      const result = await renderVerticalShort({
        sourceVideoUrl: usingClip ? clip!.url : sourceUrl,
        startSec: usingClip ? 0 : startSec,
        endSec: usingClip ? (clip!.durationSeconds ?? (endSec - startSec)) : endSec,
        captions: withCaptions ? buildCaptionChunks(rawCues.map(c => ({ start: c.startSec, end: c.endSec, text: c.text }))) : [],
        style,
        hook: '',
        sourcePublicId: usingClip ? null : ((video?.cloudinary_source_id as string | null) || null),
      })
      // Purge the intermediate trim regardless of outcome (we don't retain it).
      if (usingClip && clip?.url) {
        const p = storagePathFromPublicUrl(clip.url, 'instagram-videos')
        if (p) { try { await supabase.storage.from('instagram-videos').remove([p]) } catch { /* non-fatal */ } }
      }
      if (!result) {
        const detail = getLastShortError() || 'unknown error'
        try {
          await sb.from('youtube_shorts')
            .update({ status: 'failed', render_error: detail, updated_at: new Date().toISOString() })
            .eq('id', shortId).eq('user_id', user.id)
        } catch { /* non-fatal */ }
        return NextResponse.json({ error: `Couldn't render the clip: ${detail}` }, { status: 500 })
      }
      renderedUrl = result.url
      // Cache the one-time Cloudinary source upload (full-source path only).
      if (!usingClip && result.sourcePublicId && result.sourcePublicId !== video?.cloudinary_source_id) {
        try {
          await sb.from('youtube_videos')
            .update({ cloudinary_source_id: result.sourcePublicId })
            .eq('id', short.video_id).eq('user_id', user.id)
        } catch { /* non-fatal */ }
      }
    }

    // Both engines failed → mark failed and surface the REAL reason.
    if (!renderedUrl) {
      const detail = getLastIngestError() || getLastShortError() || 'the video fetch/render failed'
      try {
        await sb.from('youtube_shorts')
          .update({ status: 'failed', render_error: detail, updated_at: new Date().toISOString() })
          .eq('id', shortId).eq('user_id', user.id)
      } catch { /* non-fatal */ }
      // The only path here was the YouTube segment fetch (no uploaded source), and
      // YouTube frequently blocks server-side downloads. Point the user at the
      // reliable fix (upload the source) instead of a dead-end error. The raw
      // service reason is kept in render_error above for debugging; the user gets
      // one clean, actionable line.
      if (!hasSource) {
        return NextResponse.json({
          error: 'YouTube didn’t let us grab this clip automatically (it does this sometimes). Click “Upload or pick a short” to add the video once, then every clip from it renders reliably.',
          needsUpload: true, videoId: short.video_id,
        }, { status: 412 })
      }
      return NextResponse.json({ error: `Couldn't render the clip: ${detail}` }, { status: 500 })
    }

    const { data: updated } = await sb.from('youtube_shorts')
      .update({
        status: 'rendered',
        rendered_url: renderedUrl,
        subtitle_style: style,
        render_error: null,
        rendered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', shortId).eq('user_id', user.id)
      .select('*').maybeSingle()

    // Real render cost — separate feature so it never inflates the cap counter.
    recordUsage({ userId: user.id, tier, feature: 'shorts_render_cost', model: engine, images: 1 })
    // If the atomic claim was unavailable (RPC hiccup), count this render against
    // the cap the old (non-atomic) way so the quota still advances.
    if (!reservationId) recordUsage({ userId: user.id, tier, feature: 'shorts_render', model: 'reserved', images: 0 })
    renderSucceeded = true
    return NextResponse.json({ ok: true, short: updated ? rowToShort(updated) : null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[shorts/render]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    // Refund the reserved cap slot when the render didn't finish (both engines
    // failed, a needs-upload bail-out, or an exception) — a failed render must
    // never burn the user's monthly quota.
    if (reservationId && !renderSucceeded) {
      try { await createAdminClient().from('ai_usage').delete().eq('id', reservationId) } catch { /* best-effort refund */ }
    }
  }
}
