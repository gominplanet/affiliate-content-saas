// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MUSIC BEDS (lib/music-bed): tick a mood, a tempo and a style, MVP makes a
// preview with Stable Audio 3 on fal at the length asked, keeps it in MVP's
// own storage, checks it for voices, and the creator accepts it or makes
// another. Admin first (lib/labs-preview music_beds), then the Edit Studio.
//
//   GET                       the creator's beds, newest first
//   POST { action: 'make' }   moods, tempo, styles, seconds, model
//   POST { action: 'check' }  id: run the voice check again
//   POST { action: 'accept' } id: only a checked, clean preview
//   POST { action: 'reject' } id

import { NextResponse } from 'next/server'
import { fal } from '@fal-ai/client'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { recordUsage } from '@/lib/ai-usage'
import { BED_MODELS, NEGATIVE_PROMPT, bedPrompt, canAccept, readAsk, voiceVerdict, type VoiceCheck } from '@/lib/music-bed'

export const maxDuration = 300

const BUCKET = 'instagram-videos'
const COLS = 'id, model, moods, tempo, styles, seconds, prompt, seed, url, voice_check, heard, status, error, created_at, accepted_at'

if (process.env.FAL_KEY) {
  try { fal.config({ credentials: process.env.FAL_KEY }) } catch { /* the client configures itself at call time */ }
}

// music_beds is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const tableMissing = (m?: string) => /music_beds/.test(m || '') && /does not exist|schema cache|could not find/i.test(m || '')
const MISSING_WORDS = 'Music beds need migration 475 (the music_beds table). Run it in the Supabase SQL editor, then try again.'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  const { data: intg } = await (supabase as Db).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('music_beds', intg?.tier)) return { error: NextResponse.json({ error: 'Music beds are not open on your plan yet.' }, { status: 403 }) }
  return { userId: user.id as string, tier: (intg?.tier as string) || null }
}

/** The voice check, on its own call: a check that could not run says so, so
 *  it never reads as clean (transcribeToCues answers [] for both). */
async function checkVoices(url: string): Promise<{ check: VoiceCheck; heard: string[]; error: string | null }> {
  if (!process.env.FAL_KEY) return { check: 'unchecked', heard: [], error: 'the transcriber is not set up' }
  try {
    const r = await fal.subscribe('fal-ai/whisper', {
      input: { audio_url: url, task: 'transcribe', chunk_level: 'segment', language: 'en' },
      abortSignal: AbortSignal.timeout(60_000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = ((r as any)?.data ?? r) as { text?: unknown }
    if (typeof data?.text !== 'string') return { check: 'unchecked', heard: [], error: 'the transcriber gave no answer' }
    const v = voiceVerdict(data.text)
    return { check: v.verdict, heard: v.heard, error: null }
  } catch (e) {
    return { check: 'unchecked', heard: [], error: e instanceof Error && /abort|timeout/i.test(e.message) ? 'it took too long' : 'the transcriber failed' }
  }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient() as Db
  const { data, error } = await admin.from('music_beds').select(COLS).eq('user_id', g.userId).order('created_at', { ascending: false }).limit(40)
  if (error) return NextResponse.json({ error: tableMissing(error.message) ? MISSING_WORDS : error.message }, { status: 500 })
  return NextResponse.json({ beds: data || [] })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  const admin = createAdminClient() as Db

  if (action === 'make') {
    const read = readAsk(body)
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 })
    const ask = read.ask
    if (!process.env.FAL_KEY) return NextResponse.json({ error: 'Music is not set up on this server (no fal key).' }, { status: 503 })
    // The table first, so a missing migration costs nothing.
    const probe = await admin.from('music_beds').select('id').limit(1)
    if (probe.error) return NextResponse.json({ error: tableMissing(probe.error.message) ? MISSING_WORDS : probe.error.message }, { status: 500 })

    const model = BED_MODELS[ask.model]
    const prompt = bedPrompt(ask)
    let audioUrl = ''
    let seed: number | null = null
    try {
      const r = await fal.subscribe(model.id, {
        input: { prompt, negative_prompt: NEGATIVE_PROMPT, duration: ask.seconds, output_format: 'mp3', bitrate: '320k' },
        abortSignal: AbortSignal.timeout(110_000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = ((r as any)?.data ?? r) as { audio?: { url?: unknown }; seed?: unknown }
      audioUrl = typeof data?.audio?.url === 'string' ? data.audio.url : ''
      seed = typeof data?.seed === 'number' ? data.seed : null
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      return NextResponse.json({ error: /abort|timeout/i.test(msg) ? 'Stable Audio took too long. Try again, or a shorter length.' : `Stable Audio did not make the track${msg ? `: ${msg.slice(0, 160)}` : ''}.` }, { status: 502 })
    }
    if (!audioUrl) return NextResponse.json({ error: 'Stable Audio answered without a track. Try again.' }, { status: 502 })
    recordUsage({ userId: g.userId, tier: g.tier, feature: 'music_bed', model: model.usage, images: 1 })

    // Kept in MVP's own storage: fal's link does not last.
    const id = crypto.randomUUID()
    const path = `music-beds/${g.userId}/${id}.mp3`
    let url: string
    try {
      const a = await fetch(audioUrl, { signal: AbortSignal.timeout(45_000) })
      if (!a.ok) throw new Error(`fal answered ${a.status}`)
      const buf = Buffer.from(await a.arrayBuffer())
      const up = await admin.storage.from(BUCKET).upload(path, buf, { contentType: 'audio/mpeg', upsert: true })
      if (up.error) throw new Error(up.error.message)
      url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl as string
    } catch (e) {
      return NextResponse.json({ error: `The track was made but MVP could not keep it (${e instanceof Error ? e.message : 'no answer'}). Try again.` }, { status: 502 })
    }

    const v = await checkVoices(url)
    recordUsage({ userId: g.userId, tier: g.tier, feature: 'music_bed_check', model: 'fal-whisper-clip', images: 1 })
    const row = { id, user_id: g.userId, model: ask.model, moods: ask.moods, tempo: ask.tempo, styles: ask.styles, seconds: ask.seconds, prompt, seed, storage_path: path, url,
      voice_check: v.check, heard: v.heard, status: v.check === 'voices' ? 'rejected' : 'preview', error: v.error }
    const { data, error } = await admin.from('music_beds').insert(row).select(COLS).single()
    if (error) return NextResponse.json({ error: `The track was made but not saved: ${error.message}` }, { status: 500 })
    return NextResponse.json({ bed: data })
  }

  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''
  if (!id) return NextResponse.json({ error: 'Which track?' }, { status: 400 })
  const { data: bed, error: readErr } = await admin.from('music_beds').select(COLS).eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (readErr) return NextResponse.json({ error: tableMissing(readErr.message) ? MISSING_WORDS : readErr.message }, { status: 500 })
  if (!bed) return NextResponse.json({ error: 'That track is not yours or is gone.' }, { status: 404 })

  if (action === 'check') {
    const v = await checkVoices(bed.url)
    recordUsage({ userId: g.userId, tier: g.tier, feature: 'music_bed_check', model: 'fal-whisper-clip', images: 1 })
    const { data, error } = await admin.from('music_beds').update({ voice_check: v.check, heard: v.heard, error: v.error, status: v.check === 'voices' ? 'rejected' : bed.status }).eq('id', id).select(COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ bed: data })
  }
  if (action === 'accept') {
    if (!canAccept(bed.voice_check, bed.status)) return NextResponse.json({ error: bed.voice_check === 'clean' ? 'This track is not a preview any more.' : 'Only a track checked with no voices can be accepted.' }, { status: 409 })
    const { data, error } = await admin.from('music_beds').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', id).select(COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ bed: data })
  }
  if (action === 'reject') {
    const { data, error } = await admin.from('music_beds').update({ status: 'rejected' }).eq('id', id).select(COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ bed: data })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
