// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/dub — Storefront Sync Milestone 2.
// Dub ONE market's copy: translate the master transcript into a spoken script,
// synthesize a voiceover in that language, and mux it onto the master video
// (time-stretched to match). On-demand per market so each request stays bounded.
//   body: { jobId, domain }  ->  { ok, videoUrl } | { error }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { recordUsage } from '@/lib/ai-usage'
import { checkUsageCap, PRIMARY_FEATURE, DUB_MONTHLY_CAP } from '@/lib/usage-cap'
import { marketByDomain, translateScript } from '@/lib/global-sync'
import { synthesizeSpeech, ttsConfigured, elevenConfigured } from '@/lib/tts'
import { getClonedVoiceId } from '@/lib/voice-clone'
import { ingestConfigured, ingestYouTubeVideo, renderDub } from '@/lib/youtube-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier,subscription_period_start,subscription_period_end').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Global Storefront Sync is a Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
  }
  const gate = await spendGate(user.id, tier)
  if (gate) return gate

  if (!ingestConfigured()) {
    return NextResponse.json({ error: 'The video service is not available right now. Please try again shortly.' }, { status: 503 })
  }
  if (!ttsConfigured()) {
    return NextResponse.json({ error: 'Voiceover is not configured right now.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string; domain?: string }
  const jobId = (body.jobId || '').trim()
  const domain = (body.domain || '').trim()
  const market = marketByDomain(domain)
  if (!jobId || !market) return NextResponse.json({ error: 'jobId and a valid market are required.' }, { status: 400 })
  if (!market.needsTranslation) return NextResponse.json({ error: 'This market speaks English — no dub needed.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: job } = await sb.from('global_sync_jobs').select('id,video_id').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Sync job not found.' }, { status: 404 })
  const { data: target } = await sb.from('global_sync_targets').select('id,state').eq('job_id', jobId).eq('domain', domain).eq('user_id', user.id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Market not found on this job.' }, { status: 404 })

  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,youtube_video_id,transcript,duration_seconds,source_video_url')
    .eq('id', job.video_id).eq('user_id', user.id).maybeSingle()
  if (!video) return NextResponse.json({ error: 'Master video not found.' }, { status: 404 })

  const transcript = (video.transcript as string | null) || ''
  if (!transcript.trim()) {
    await sb.from('global_sync_targets').update({ detail: 'No transcript to dub yet.', updated_at: new Date().toISOString() }).eq('id', target.id)
    return NextResponse.json({ error: 'This video has no transcript yet, so there is nothing to dub.', noTranscript: true }, { status: 422 })
  }

  await sb.from('global_sync_targets').update({ state: 'dubbing', detail: null, updated_at: new Date().toISOString() }).eq('id', target.id)

  try {
    const { data: brand } = await sb.from('brand_profiles').select('learn_profile,voice_fingerprint,channel_voice_fingerprints').eq('user_id', user.id).maybeSingle()

    // 1) Translate the transcript into a spoken script.
    const script = await translateScript(transcript, market, brand, { userId: user.id, tier })
    if (!script) throw new Error('Could not build the dub script.')

    // 2) Pick the dub lane. A creator with a cloned voice gets the premium
    // ElevenLabs "sounds like you" dub, which is capped per period; everyone
    // else (and anyone over the premium cap) gets the standard OpenAI voice,
    // which is ~7x cheaper and uncapped. So dubbing every geo on every video
    // never blocks — it only drops to the standard voice past the premium cap.
    const clonedVoiceId = await getClonedVoiceId(sb, user.id)
    const wantClone = !!clonedVoiceId && elevenConfigured()
    let cloneCapHit = false
    let clonedRemaining: number | null = null
    if (wantClone) {
      const capLimit = tier === 'admin' ? null : DUB_MONTHLY_CAP
      const capCheck = await checkUsageCap(
        sb, user.id, PRIMARY_FEATURE.dub, capLimit,
        (integ?.subscription_period_start as string | null) ?? null,
        (integ?.subscription_period_end as string | null) ?? null,
      )
      if (capCheck?.exceeded) cloneCapHit = true
      else clonedRemaining = capLimit === null ? null : Math.max(0, capLimit - ((capCheck?.used ?? 0) + 1))
    }
    const useVoiceId = wantClone && !cloneCapHit ? clonedVoiceId : undefined

    // 3) Synthesize. The engine detects the language from the translated script.
    const speech = await synthesizeSpeech(script, useVoiceId ? { voiceId: useVoiceId } : undefined)
    if (!speech) throw new Error('Voiceover engine is not available.')
    const mp3 = speech.buffer
    const usedClone = speech.engine === 'elevenlabs' && !!useVoiceId
    // Price by the real synthesized character count so it counts accurately
    // toward the account spend ceiling; only the cloned lane counts to the cap.
    recordUsage({
      userId: user.id, tier,
      feature: usedClone ? 'global_sync_dub_cloned' : 'global_sync_dub_std',
      model: speech.engine === 'elevenlabs' ? 'elevenlabs-multilingual-v2' : 'openai-tts-1',
      output: script.length,
    })
    const voice: 'cloned' | 'standard' = usedClone ? 'cloned' : 'standard'

    // 4) Host the audio so the render service can fetch it.
    const admin = createAdminClient()
    const audioKey = `${user.id}/dub-${jobId}-${market.code}-${Date.now()}.mp3`
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
      const ing = ytId ? await ingestYouTubeVideo(ytId, user.id) : null
      if (ing?.url) {
        sourceUrl = ing.url
        if (ing.durationSeconds) durationSec = ing.durationSeconds
        await sb.from('youtube_videos').update({ source_video_url: sourceUrl }).eq('id', video.id)
      }
    }
    if (!/^https:\/\//i.test(sourceUrl)) {
      // No source video available — still deliver the voiceover track itself.
      await sb.from('global_sync_targets').update({ video_url: audioUrl, state: 'localized', detail: 'Voiceover ready. Add the source video in Clip Factory to mux the dub.', updated_at: new Date().toISOString() }).eq('id', target.id)
      return NextResponse.json({ ok: true, audioUrl, videoUrl: null, note: 'voiceover_only', voice, clonedDubsRemaining: clonedRemaining, cloneCapHit })
    }

    // 6) Mux the dub onto the video.
    const dubbed = await renderDub(sourceUrl, audioUrl, user.id, durationSec || undefined)
    if (!dubbed) throw new Error('The dub render did not finish.')

    await sb.from('global_sync_targets').update({ video_url: dubbed, state: 'localized', detail: voice === 'cloned' ? 'Dubbed in your voice' : 'Dubbed', updated_at: new Date().toISOString() }).eq('id', target.id)
    return NextResponse.json({ ok: true, videoUrl: dubbed, voice, clonedDubsRemaining: clonedRemaining, cloneCapHit })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Dub failed.'
    await sb.from('global_sync_targets').update({ state: 'failed', detail: msg.slice(0, 200), updated_at: new Date().toISOString() }).eq('id', target.id)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
