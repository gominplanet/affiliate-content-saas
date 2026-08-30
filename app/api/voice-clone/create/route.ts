// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/voice-clone/create — clone the creator's voice for dubs.
// Sources the audio from one of their YouTube videos (or a supplied audio URL),
// then creates an ElevenLabs cloned voice and stores it on their brand profile.
//   body: { youtubeVideoId?, audioUrl?, name?, consent: true }
//   -> { ok, voiceId } | { error }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { ingestConfigured, ingestAudio } from '@/lib/youtube-ingest'
import { voiceCloneConfigured, createClonedVoice } from '@/lib/voice-clone'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Voice cloning is a Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
  }
  if (!voiceCloneConfigured()) {
    return NextResponse.json({ error: 'Voice cloning is not switched on yet.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { youtubeVideoId?: string; audioUrl?: string; name?: string; consent?: boolean }
  if (!body.consent) {
    return NextResponse.json({ error: 'Please confirm you have the right to clone this voice.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Gather sample audio. Priority: a supplied hosted URL, else extract audio
  // from the given YouTube video (or the creator's most recent one).
  const audioUrls: string[] = []
  const suppliedUrl = (body.audioUrl || '').trim()
  if (/^https:\/\//i.test(suppliedUrl)) audioUrls.push(suppliedUrl)

  let sourceLabel = 'My voice'
  if (audioUrls.length === 0) {
    if (!ingestConfigured()) return NextResponse.json({ error: 'The audio service is not available right now.' }, { status: 503 })
    let ytId = (body.youtubeVideoId || '').trim()
    if (!/^[A-Za-z0-9_-]{11}$/.test(ytId)) {
      const { data: v } = await sb
        .from('youtube_videos').select('youtube_video_id,title')
        .eq('user_id', user.id).not('youtube_video_id', 'is', null)
        .order('published_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
      ytId = (v?.youtube_video_id as string | null) || ''
      if (v?.title) sourceLabel = String(v.title).slice(0, 60)
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(ytId)) {
      return NextResponse.json({ error: 'No video to learn your voice from. Sync your channel first, or upload a sample.' }, { status: 400 })
    }
    const url = await ingestAudio(ytId, user.id)
    if (!url) return NextResponse.json({ error: "Couldn't pull the audio from that video. Try another one." }, { status: 502 })
    audioUrls.push(url)
  }

  const name = (body.name || sourceLabel || 'My voice').slice(0, 60)
  try {
    const { voiceId } = await createClonedVoice(sb, user.id, audioUrls, name)
    return NextResponse.json({ ok: true, voiceId })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Voice cloning failed.' }, { status: 502 })
  }
}
