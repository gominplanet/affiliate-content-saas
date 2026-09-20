// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Dub ONE market's copy of one video. The whole lane, in one place.
//
// WHY IT IS A LIBRARY AND NOT JUST A ROUTE. This lived entirely inside
// /api/global-sync/dub, which needs a signed-in creator, and the only caller
// was the browser. So the background catalogue drain, which has no session,
// could not dub at all: it created the sync job, the recovery cron translated
// the title and description, and the delivery queue then served the market the
// MASTER ENGLISH AUDIO under a French title while the grid said ready. That is
// the failure the Launchpad guard was written to catch, arriving through the
// one door that guard does not watch.
//
// The fix is one path used by both, not a second implementation for the cron.
// A second implementation is where the YouTube-track-first ordering silently
// stops happening, and nothing on any screen would show it.
//
// THE ORDER MATTERS AND IT IS NOT AN OPTIMIZATION.
//
//   1. YouTube's own track, when the video already carries this language. It is
//      already translated, already timed to the picture, and costs nothing.
//   2. Our dub: transcribe if needed, translate the script, synthesize, mux.
//      Free and unlimited on the standard voice.
//
// The cloned voice is the only paid lane and only when a creator asks for it,
// which is why the background caller never gets one: nobody is present to
// authorize spending a credit.

import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'
import { marketByDomain, translateScript } from '@/lib/global-sync'
import { synthesizeSpeech, elevenConfigured } from '@/lib/tts'
import { getClonedVoiceId } from '@/lib/voice-clone'
import { dubCreditBalance, spendDubCredit } from '@/lib/dub-credits'
import { ingestConfigured, ingestYouTubeVideo, renderDub, listYouTubeAudioTracks, hasAudioTrack } from '@/lib/youtube-ingest'
import { transcribeToCues, transcriptionConfigured } from '@/lib/shorts-transcribe'
import { cuesToText } from '@/lib/shorts-transcript'

export interface DubTargetOpts {
  /** A Supabase client. Every query below is scoped by user_id explicitly, so
   *  the caller may pass the user's own client or the service-role one. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  userId: string
  tier: string
  jobId: string
  domain: string
  /** The creator chose the free generic voice over their own clone.
   *
   *  THE BACKGROUND LANE ALWAYS PASSES TRUE, and that is deliberate twice over.
   *  It spends no credit, because nobody is there to agree to it. And it makes
   *  YouTube's existing track eligible, because the track is only skipped when
   *  a cloned voice is genuinely on the table: substituting a generic voice for
   *  one a creator paid to sound like them is a downgrade they did not ask for,
   *  but that reasoning does not apply when no clone is being used. */
  requestedStandard?: boolean
  /** Subscription period start, for the cloned-voice credit window. */
  periodStart?: string | null
}

export type DubTargetResult =
  | {
      ok: true
      videoUrl: string | null
      audioUrl?: string
      voice: 'youtube' | 'cloned' | 'standard'
      /** 'youtube_dub' when YouTube's own track was used, 'voiceover_only' when
       *  there was no source video to mux onto. Named so a screen can say where
       *  the audio came from: a dub the creator did not pay for should never be
       *  reported as one they did. */
      note?: string
      clonedDubsRemaining: number | null
      outOfCredits: boolean
    }
  | { ok: false; error: string; status: number; noTranscript?: boolean }

export async function dubTarget(opts: DubTargetOpts): Promise<DubTargetResult> {
  const { sb, userId, tier, jobId, domain, requestedStandard = false, periodStart = null } = opts

  const market = marketByDomain(domain)
  if (!jobId || !market) return { ok: false, error: 'jobId and a valid market are required.', status: 400 }
  if (!market.needsTranslation) {
    return { ok: false, error: 'This market speaks English, so no dub is needed.', status: 400 }
  }

  const { data: job } = await sb.from('global_sync_jobs').select('id,video_id').eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (!job) return { ok: false, error: 'Sync job not found.', status: 404 }
  const { data: target } = await sb.from('global_sync_targets').select('id,state').eq('job_id', jobId).eq('domain', domain).eq('user_id', userId).maybeSingle()
  if (!target) return { ok: false, error: 'Market not found on this job.', status: 404 }

  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,youtube_video_id,transcript,duration_seconds,source_video_url')
    .eq('id', job.video_id).eq('user_id', userId).maybeSingle()
  if (!video) return { ok: false, error: 'Master video not found.', status: 404 }

  // ── 0) YOUTUBE MAY HAVE ALREADY DUBBED THIS ──────────────────────────────
  //
  // YouTube auto-dubs a lot of videos now, and a creator can upload their own
  // multi-audio tracks. When a track exists in this market's language it is
  // already translated, already timed to the picture, and already paid for. So
  // it is tried FIRST, before the transcript requirement below, because none of
  // the work underneath is needed: no transcription, no translation, no
  // synthesis, no cloned-voice credit.
  //
  // Only the language is checked, never assumed. `audioLanguage` on the result
  // is what the downloader actually obtained, so a video with no French track
  // falls through to the paid lane instead of publishing English audio to
  // amazon.fr, which is the failure that would look exactly like success.
  //
  // Skipped for the cloned-voice lane on purpose: a creator paying for a dub
  // that sounds like them is buying something YouTube's generic voice does not
  // provide, and silently substituting it would be a downgrade they did not ask
  // for. They can still choose it with voice: 'standard'.
  //
  // But the condition is "not getting a clone", NOT "asked for standard". Most
  // callers send no voice at all and the lane is picked for them further down,
  // so gating on the explicit flag alone would have meant this almost never
  // ran: a creator with no cloned voice, or out of credits, would still have
  // got our generic TTS when YouTube had a real dub sitting there for free.
  // getClonedVoiceId is one cheap read and the paid lane re-reads it below.
  const clonedForLane = await getClonedVoiceId(sb, userId)
  const cloneIsOnTheTable = !requestedStandard && !!clonedForLane && elevenConfigured()

  const marketLang = (market.lang || '').split('-')[0].toLowerCase()
  const ytIdForDub = (video.youtube_video_id as string | null) || ''
  if (!cloneIsOnTheTable && marketLang && ytIdForDub && ingestConfigured()) {
    const tracks = await listYouTubeAudioTracks(ytIdForDub)
    if (hasAudioTrack(tracks, marketLang)) {
      await sb.from('global_sync_targets').update({ state: 'dubbing', detail: null, updated_at: new Date().toISOString() }).eq('id', target.id)
      const pulled = await ingestYouTubeVideo(ytIdForDub, userId, { audioLanguage: marketLang })
      if (pulled?.url && pulled.audioLanguage) {
        await sb.from('global_sync_targets').update({
          video_url: pulled.url,
          state: 'localized',
          detail: `Dubbed by YouTube (${market.langName})`,
          updated_at: new Date().toISOString(),
        }).eq('id', target.id)
        return {
          ok: true, videoUrl: pulled.url, voice: 'youtube', note: 'youtube_dub',
          clonedDubsRemaining: null, outOfCredits: false,
        }
      }
      // The listing said the track was there and the download did not produce
      // it. Fall through and dub it ourselves rather than ship the original.
    }
  }

  let transcript = (video.transcript as string | null) || ''
  // Lazy transcription for a file-first master: if we don't have a transcript
  // yet but we do have the hosted source, transcribe it now and cache it.
  if (!transcript.trim()) {
    const src = (video.source_video_url as string | null) || ''
    if (transcriptionConfigured() && /^https:\/\//i.test(src)) {
      try {
        const t = cuesToText(await transcribeToCues(src)).slice(0, 20000)
        if (t.trim()) { transcript = t; await sb.from('youtube_videos').update({ transcript: t }).eq('id', video.id) }
      } catch { /* fall through to the no-transcript result */ }
    }
  }
  if (!transcript.trim()) {
    await sb.from('global_sync_targets').update({ detail: 'No transcript to dub yet.', updated_at: new Date().toISOString() }).eq('id', target.id)
    return { ok: false, error: 'This video has no transcript yet, so there is nothing to dub.', status: 422, noTranscript: true }
  }

  await sb.from('global_sync_targets').update({ state: 'dubbing', detail: null, updated_at: new Date().toISOString() }).eq('id', target.id)

  try {
    const { data: brand } = await sb.from('brand_profiles').select('learn_profile,voice_fingerprint,channel_voice_fingerprints').eq('user_id', userId).maybeSingle()

    // 1) Translate the transcript into a spoken script.
    const script = await translateScript(transcript, market, brand, { userId, tier })
    if (!script) throw new Error('Could not build the dub script.')

    // 2) Pick the dub lane. A creator with a cloned voice gets the premium
    // ElevenLabs "sounds like you" dub, which spends one credit; everyone else
    // (and anyone out of credits) gets the standard OpenAI voice, which is ~7x
    // cheaper and free/unlimited. So dubbing every geo on every video never
    // blocks — it only drops to the standard voice when the credits run out.
    const clonedVoiceId = await getClonedVoiceId(sb, userId)
    const wantClone = !requestedStandard && !!clonedVoiceId && elevenConfigured()
    let outOfCredits = false
    if (wantClone) {
      const bal = await dubCreditBalance(sb, userId, tier, periodStart)
      if (bal !== null && bal < 1) outOfCredits = true // null = admin/unlimited
    }
    const useVoiceId = wantClone && !outOfCredits ? clonedVoiceId : undefined

    // 3) Synthesize. The engine detects the language from the translated script.
    const speech = await synthesizeSpeech(script, useVoiceId ? { voiceId: useVoiceId } : undefined)
    if (!speech) throw new Error('Voiceover engine is not available.')
    const mp3 = speech.buffer
    const usedClone = speech.engine === 'elevenlabs' && !!useVoiceId
    // Spend a credit only when the premium (cloned) voice actually ran.
    let clonedRemaining: number | null = null
    if (usedClone) {
      const res = await spendDubCredit(sb, userId, tier, periodStart)
      clonedRemaining = res.balance
    }
    // Price by the real synthesized character count so it counts accurately
    // toward the account spend ceiling; the cloned lane also spent a credit.
    recordUsage({
      userId, tier,
      feature: usedClone ? 'global_sync_dub_cloned' : 'global_sync_dub_std',
      model: speech.engine === 'elevenlabs' ? 'elevenlabs-multilingual-v2' : 'openai-tts-1',
      output: script.length,
    })
    const voice: 'cloned' | 'standard' = usedClone ? 'cloned' : 'standard'

    // 4) Host the audio so the render service can fetch it.
    const admin = createAdminClient()
    const audioKey = `${userId}/dub-${jobId}-${market.code}-${Date.now()}.mp3`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (admin.storage as any).from('instagram-videos').upload(audioKey, mp3, { contentType: 'audio/mpeg', upsert: false })
    if (upErr) throw new Error(upErr.message || 'Could not store the voiceover.')
    const { data: audioUrlData } = admin.storage.from('instagram-videos').getPublicUrl(audioKey)
    const audioUrl = audioUrlData.publicUrl

    // 5) Make sure we have a hosted source MP4 to dub onto (auto-pull once).
    let sourceUrl = (video.source_video_url as string | null) || ''
    let durationSec = Number(video.duration_seconds) || 0
    if (!/^https:\/\//i.test(sourceUrl)) {
      const ytId = (video.youtube_video_id as string | null) || ''
      const ing = ytId ? await ingestYouTubeVideo(ytId, userId) : null
      if (ing?.url) {
        sourceUrl = ing.url
        if (ing.durationSeconds) durationSec = ing.durationSeconds
        await sb.from('youtube_videos').update({ source_video_url: sourceUrl }).eq('id', video.id)
      }
    }
    if (!/^https:\/\//i.test(sourceUrl)) {
      // No source video available — still deliver the voiceover track itself.
      await sb.from('global_sync_targets').update({ video_url: audioUrl, state: 'localized', detail: 'Voiceover ready. Add the source video in Clip Factory to mux the dub.', updated_at: new Date().toISOString() }).eq('id', target.id)
      return { ok: true, audioUrl, videoUrl: null, note: 'voiceover_only', voice, clonedDubsRemaining: clonedRemaining, outOfCredits }
    }

    // 6) Mux the dub onto the video.
    const dubbed = await renderDub(sourceUrl, audioUrl, userId, durationSec || undefined)
    if (!dubbed) throw new Error('The dub render did not finish.')

    await sb.from('global_sync_targets').update({ video_url: dubbed, state: 'localized', detail: voice === 'cloned' ? 'Dubbed in your voice' : 'Dubbed', updated_at: new Date().toISOString() }).eq('id', target.id)
    return { ok: true, videoUrl: dubbed, voice, clonedDubsRemaining: clonedRemaining, outOfCredits }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Dub failed.'
    await sb.from('global_sync_targets').update({ state: 'failed', detail: msg.slice(0, 200), updated_at: new Date().toISOString() }).eq('id', target.id)
    return { ok: false, error: msg, status: 502 }
  }
}
