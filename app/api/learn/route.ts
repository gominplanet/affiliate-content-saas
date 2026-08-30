/**
 * GET/POST /api/learn
 *
 * The LEARN page is the single editing surface for the writer's voice.
 * It owns four free-text columns that used to live on Brand Profile
 * (writing_sample, author_bio, target_audience, words_to_avoid) plus
 * the structured `learn_profile` jsonb. The blog agents read all of it.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeLearnProfile } from '@/lib/learn'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  try {
    const supabase = await createServerClient()
    // 2026-06-09 Phase 2 (VA): LEARN profile is owner-side — VAs read it
    // so generation honors the owner's voice. UI gating prevents VAs from
    // landing on /learn, but if reached we still route through ownerId.
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: row } = await sb
      .from('brand_profiles')
      .select('writing_sample,author_bio,target_audience,words_to_avoid,learn_profile,voice_fingerprint,voice_fingerprint_updated_at,voice_fingerprint_sources,channel_voice_fingerprints')
      .eq('user_id', ownerId)
      .single()

    // Per-channel fingerprints (migration 302). Turn the stored { channelId: {…} }
    // map into a titled array for the UI, resolving channel names from the
    // creator's synced videos. Only present for multi-channel creators.
    type ChanEntry = { text?: string; updated_at?: string; sources?: number }
    const rawMap = (row?.channel_voice_fingerprints && typeof row.channel_voice_fingerprints === 'object')
      ? row.channel_voice_fingerprints as Record<string, ChanEntry> : {}
    const channelIds = Object.keys(rawMap).filter(id => ((rawMap[id]?.text || '').trim().length >= 120))
    const titleById = new Map<string, string>()
    if (channelIds.length) {
      const { data: vs } = await sb
        .from('youtube_videos')
        .select('channel_id,channel_title')
        .eq('user_id', ownerId)
        .in('channel_id', channelIds)
        .not('channel_title', 'is', null)
        .limit(400)
      for (const v of (Array.isArray(vs) ? vs : [])) {
        const cid = v.channel_id as string
        if (cid && !titleById.has(cid) && v.channel_title) titleById.set(cid, v.channel_title as string)
      }
    }
    const channelVoices = channelIds.map(id => ({
      channelId: id,
      title: titleById.get(id) || 'Channel',
      text: (rawMap[id]?.text || '').trim(),
      sources: rawMap[id]?.sources || 0,
      updatedAt: rawMap[id]?.updated_at || null,
    }))

    return NextResponse.json({
      writing_sample: row?.writing_sample ?? '',
      author_bio: row?.author_bio ?? '',
      target_audience: row?.target_audience ?? '',
      words_to_avoid: row?.words_to_avoid ?? '',
      learn_profile: normalizeLearnProfile(row?.learn_profile),
      // Continually-learned voice fingerprint (read-only in the UI). Null/0 until
      // migration 301 runs and the learner has read at least one transcript.
      voice_fingerprint: row?.voice_fingerprint ?? '',
      voice_fingerprint_updated_at: row?.voice_fingerprint_updated_at ?? null,
      voice_fingerprint_sources: row?.voice_fingerprint_sources ?? 0,
      // Per-channel voices (multi-channel creators only). Empty otherwise.
      channelVoices,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as {
      writing_sample?: string
      author_bio?: string
      target_audience?: string
      words_to_avoid?: string
      learn_profile?: unknown
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : '')

    // The brand_profiles row is created at onboarding; mirror the
    // existing /api/profile convention and UPDATE (not upsert — avoids
    // tripping NOT NULL columns this endpoint doesn't own).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('brand_profiles')
      .update({
        writing_sample: str(body.writing_sample),
        author_bio: str(body.author_bio),
        target_audience: str(body.target_audience),
        words_to_avoid: str(body.words_to_avoid),
        learn_profile: normalizeLearnProfile(body.learn_profile) as never,
      })
      .eq('user_id', ownerId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
