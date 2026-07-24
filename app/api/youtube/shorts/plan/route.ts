/**
 * POST /api/youtube/shorts/plan
 *
 * Shorts Studio — the "brain". Reads the timestamped transcript of a long-form
 * video and returns the best 15–30s moments to cut as vertical Shorts, each with
 * a hook + caption + verbatim subtitles. No video file needed; this runs on the
 * transcript alone, so it works for every user instantly. Rendering the picked
 * clips is a separate, opt-in step (/api/youtube/shorts/render).
 *
 * Body: { videoId (youtube_videos.id) | youtubeVideoId, count?, cues? }
 * Returns: { ok, shorts: ShortRow[] } | { error, noTranscript? }
 *
 * Pro-only (video-processing feature; matches the Instagram burner). AI cost is
 * bounded by the per-account monthly spend ceiling (spendGate), same model the
 * YouTube metadata generator uses for "free enrichment" work.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { fetchTranscriptCues, cuesToText, normalizeCues } from '@/lib/shorts-transcript'
import { planShorts } from '@/lib/shorts-planner'
import { rowToShort } from '@/lib/shorts-row'
import type { ShortRow, TranscriptCue } from '@/lib/shorts-types'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier !== 'pro' && tier !== 'admin') {
      return NextResponse.json({
        error: 'Shorts Studio is a Pro feature. Upgrade to turn your long videos into ready-to-post Shorts.',
        limitReached: true, cap: 'shorts_studio', currentTier: tier,
        upgrade: { tier: 'pro', label: 'Pro', limit: null },
      }, { status: 403 })
    }

    // AI-spend circuit breaker (bounds the planner's LLM cost).
    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked

    const body = await request.json().catch(() => ({})) as {
      videoId?: string
      youtubeVideoId?: string
      count?: number
      /** Optional client-supplied timestamped cues (e.g. SCOUT fetched them from
       *  the browser IP when the server scraper is blocked). Trusted as-is. */
      cues?: Array<{ text?: string; offset?: number; duration?: number }>
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const videoId = (body.videoId || '').trim()
    const ytId = (body.youtubeVideoId || '').trim()
    if (!videoId && !ytId) {
      return NextResponse.json({ error: 'A video is required.' }, { status: 400 })
    }

    // Resolve the source video row (must belong to the caller).
    const q = sb.from('youtube_videos')
      .select('id,youtube_video_id,title,transcript')
      .eq('user_id', user.id)
    const { data: video } = await (videoId
      ? q.eq('id', videoId)
      : q.eq('youtube_video_id', ytId)).maybeSingle()
    if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })

    const youtubeVideoId = (video.youtube_video_id as string | null) || ytId || null
    const videoTitle = (video.title as string) || 'Untitled'

    // Brand voice for the hooks/captions.
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('niches,tone')
      .eq('user_id', user.id)
      .maybeSingle()
    const niches = ((brand?.niches as string[]) || []).join(', ') || 'general'
    const tone = ((brand?.tone as string[]) || []).join(', ') || 'conversational, energetic'

    // Timestamped transcript: client-supplied cues win (browser IP), else the
    // server scraper. Timings are REQUIRED here — no timings, no clip windows.
    let cues: TranscriptCue[] = []
    if (Array.isArray(body.cues) && body.cues.length > 0) {
      cues = normalizeCues(body.cues)
    } else if (youtubeVideoId) {
      cues = await fetchTranscriptCues(youtubeVideoId)
    }
    if (cues.length === 0) {
      return NextResponse.json({
        error: "We couldn't pull this video's captions with timings — YouTube sometimes blocks that from a server. Try again in a moment, or make sure the video has captions.",
        noTranscript: true,
      }, { status: 422 })
    }

    // Cache the plain transcript back if the row didn't have one (helps the
    // blog/metadata paths reuse it — same best-effort write they do).
    if (!(video.transcript as string | null)?.trim()) {
      try {
        await sb.from('youtube_videos')
          .update({ transcript: cuesToText(cues), transcript_fetched_at: new Date().toISOString() })
          .eq('id', video.id).eq('user_id', user.id)
      } catch { /* best-effort */ }
    }

    const anthropic = createAnthropicClient()
    const clips = await planShorts(anthropic, {
      cues, videoTitle, niches, tone,
      count: Math.min(10, Math.max(1, Number(body.count) || 5)),
      telemetry: { userId: user.id, tier },
    })
    if (clips.length === 0) {
      return NextResponse.json({ error: 'No strong Short-worthy moments were found in this video.', noClips: true }, { status: 422 })
    }

    // Regenerating replaces the previous SUGGESTED set for this video, but never
    // touches clips the creator already RENDERED (those are finished work).
    try {
      await sb.from('youtube_shorts')
        .delete()
        .eq('user_id', user.id).eq('video_id', video.id).eq('status', 'suggested')
    } catch { /* non-fatal */ }

    const rows = clips.map(c => ({
      user_id: user.id,
      video_id: video.id,
      youtube_video_id: youtubeVideoId,
      start_sec: c.startSec,
      end_sec: c.endSec,
      hook: c.hook,
      caption: c.caption,
      reason: c.reason,
      score: c.score,
      hashtags: c.hashtags,
      subtitles: c.subtitles,
      status: 'suggested',
    }))
    const { data: inserted, error: insErr } = await sb.from('youtube_shorts').insert(rows).select('*')
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shorts: ShortRow[] = (inserted as any[]).map(rowToShort)
    return NextResponse.json({ ok: true, shorts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[shorts/plan]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
