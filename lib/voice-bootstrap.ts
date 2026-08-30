// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Instant voice bootstrap — kill the cold start.
//
// The voice fingerprint (lib/voice-fingerprint) normally fills in as a creator
// publishes, because transcripts are only fetched lazily during generation. A
// brand-new creator therefore sounds generic on their very first post. This
// module fixes that: on demand it fetches transcripts for the creator's most
// recent videos (best-effort, bounded), caches them on youtube_videos, then
// forces a fingerprint refinement — so MVP can sound like them from post #1.
//
// Best-effort throughout: a video whose transcript can't be fetched (no
// captions, or YouTube blocking the scraper from a cloud IP) is simply skipped.
// Returns how many transcripts it fetched and whether the fingerprint updated.

import { getValidYouTubeToken, createYouTubeOAuthService } from '@/services/youtube'
import { YoutubeTranscript } from 'youtube-transcript'
import { maybeUpdateVoiceFingerprint } from '@/lib/voice-fingerprint'

const MAX_VIDEOS = 8 // transcripts to fetch per bootstrap (bounds API quota + time)

interface Ctx {
  userId: string
  tier?: string | null
}

/**
 * Fetch transcripts for the creator's recent (untranscribed) videos and refine
 * the voice fingerprint from them right away. Safe to call repeatedly — it only
 * fetches videos that don't already have a transcript.
 */
export async function bootstrapVoiceFromChannel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ctx: Ctx,
): Promise<{ ok: boolean; fetched: number; learned: boolean }> {
  try {
    // Recent videos that don't have a transcript yet, newest first.
    const { data: vids } = await supabase
      .from('youtube_videos')
      .select('id,youtube_video_id,title,transcript')
      .eq('user_id', ctx.userId)
      .is('transcript', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(20)

    const candidates = (Array.isArray(vids) ? vids : [])
      .filter((v: { youtube_video_id?: string | null }) => !!v.youtube_video_id)
      .slice(0, MAX_VIDEOS)
    if (candidates.length === 0) {
      // Nothing new to fetch. Run the normal DEBOUNCED refine (not forced) so a
      // creator who keeps clicking "Scan" doesn't pay for an LLM run each time,
      // while still folding in any transcripts earlier generations cached.
      const learned = await maybeUpdateVoiceFingerprint(supabase, ctx, { force: false })
      return { ok: true, fetched: 0, learned }
    }

    // A valid OAuth token lets us use the official captions path (best quality);
    // the scraper is the fallback. Missing token → scraper only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await (supabase as any)
      .from('integrations')
      .select('*')
      .eq('user_id', ctx.userId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yt: any = null
    try {
      if (integ?.youtube_oauth_access_token) {
        const token = await getValidYouTubeToken(integ as Record<string, unknown>)
        yt = createYouTubeOAuthService(token)
      }
    } catch { /* fall back to the scraper */ }

    let fetched = 0
    for (const v of candidates) {
      const vid = v.youtube_video_id as string
      let transcript = ''
      // Layer 1: official captions via the creator's own OAuth grant.
      if (yt) {
        try {
          const t = await yt.getTranscript(vid)
          if (t && t.trim().length >= 40) transcript = t
        } catch { /* try scraper */ }
      }
      // Layer 2: scraper (often blocked on cloud IPs, so best-effort).
      if (!transcript) {
        try {
          const segments = await YoutubeTranscript.fetchTranscript(vid, { lang: 'en' })
          const text = segments.map((s: { text: string }) => s.text).join(' ')
          if (text && text.trim().length >= 40) transcript = text
        } catch { /* skip this video */ }
      }
      if (!transcript) continue
      try {
        await supabase
          .from('youtube_videos')
          .update({ transcript, transcript_fetched_at: new Date().toISOString() })
          .eq('id', v.id)
        fetched++
      } catch { /* non-fatal */ }
    }

    // Force a fingerprint refinement ONLY when we actually cached new
    // transcripts. If nothing new was fetched (a repeated scan after everything
    // is already transcribed), fall back to the normal debounced call so a
    // creator clicking "Scan" repeatedly can't force a paid LLM run each time.
    const learned = await maybeUpdateVoiceFingerprint(supabase, ctx, { force: fetched > 0 })
    return { ok: true, fetched, learned }
  } catch {
    return { ok: false, fetched: 0, learned: false }
  }
}
