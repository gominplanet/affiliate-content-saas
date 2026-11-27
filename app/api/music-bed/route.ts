// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MUSIC BEDS (lib/music-bed): tick a mood, a tempo and a style, MVP makes a
// preview with Stable Audio 3 on fal at the length asked, keeps it in MVP's
// own storage, checks it for voices, and the creator accepts it or makes
// another. Admin first (lib/labs-preview music_beds), then the Video Builder.
//
//   GET ?brand=               the creator's beds, newest first; the MVP music
//                             library (other members' accepted tracks, migration
//                             478) with how many other creators use each for
//                             that brand; and the month's new tracks left
//   POST { action: 'share' }  id, shared: whether an accepted track is in the library
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
import { BED_MODELS, audioUrlOf, bedPrompt, canAccept, engineInput, readAsk, voiceVerdict, musicCapFor, musicAllowanceWords, type VoiceCheck, type MusicAllowance } from '@/lib/music-bed'
import { checkUsageCap } from '@/lib/usage-cap'
import { introCap, introNote } from '@/lib/intro-allowance'
import { normalizeTier } from '@/lib/tier'

export const maxDuration = 300

const BUCKET = 'instagram-videos'
const COLS = 'id, model, moods, tempo, styles, seconds, prompt, seed, url, voice_check, heard, status, error, created_at, accepted_at'

if (process.env.FAL_KEY) {
  try { fal.config({ credentials: process.env.FAL_KEY }) } catch { /* the client configures itself at call time */ }
}

// music_beds is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** The month's new tracks (lib/music-bed MUSIC_TRACKS_MONTHLY_CAP): counted on
 *  the member's own billing month, a quarter in the first 7 days. */
async function allowanceOf(admin: Db, userId: string, tier: string | null): Promise<MusicAllowance> {
  const { data: ig } = await admin.from('integrations').select('*').eq('user_id', userId).maybeSingle()
  const subscribedAt = (ig?.subscribed_at as string | null | undefined) ?? null
  const cap = musicCapFor(normalizeTier(tier))
  const limit = cap === null ? null : introCap(cap, subscribedAt)
  const c = await checkUsageCap(admin, userId, ['music_bed'], limit, (ig?.subscription_period_start as string | null) ?? null, (ig?.subscription_period_end as string | null) ?? null)
  const used = c?.used ?? 0
  return { used, limit, left: limit === null ? null : Math.max(0, limit - used), resetLabel: c?.resetLabel ?? '', introNote: limit === null ? null : introNote(subscribedAt) }
}

/** Other members' accepted tracks, checked with no voices and shared, newest
 *  first; never who made them. Empty before migration 478. */
const LIBRARY_COLS = 'id, model, moods, tempo, styles, seconds, url, voice_check, status, accepted_at'
async function libraryOf(admin: Db, userId: string, brandId: string | null): Promise<{ beds: unknown[]; usedForBrand: Record<string, number>; ready: boolean }> {
  const { data, error } = await admin.from('music_beds').select(LIBRARY_COLS).eq('status', 'accepted').eq('shared', true).eq('voice_check', 'clean').neq('user_id', userId).order('accepted_at', { ascending: false }).limit(60)
  if (error) return { beds: [], usedForBrand: {}, ready: false }
  // How many other creators already picked each one for this brand.
  const usedForBrand: Record<string, number> = {}
  if (brandId) {
    const { data: sets } = await admin.from('studio_projects').select('user_id, options').eq('brand_id', brandId).neq('user_id', userId).limit(1000)
    const who = new Map<string, Set<string>>()
    for (const p of (sets ?? []) as { user_id: string; options: { music?: { bedId?: string } | null } | null }[]) {
      const b = p.options?.music?.bedId
      if (!b) continue
      if (!who.has(b)) who.set(b, new Set())
      who.get(b)!.add(p.user_id)
    }
    for (const [b, set] of who) usedForBrand[b] = set.size
  }
  return { beds: data ?? [], usedForBrand, ready: true }
}

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

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient() as Db
  const brand = new URL(req.url).searchParams.get('brand')
  const brandId = brand && /^[A-Za-z0-9_-]{4,80}$/.test(brand) ? brand : null
  // Whether each of the creator's own accepted tracks is in the library (after migration 478).
  let mine = await admin.from('music_beds').select(`${COLS}, shared`).eq('user_id', g.userId).order('created_at', { ascending: false }).limit(40)
  if (mine.error && /shared/.test(mine.error.message)) mine = await admin.from('music_beds').select(COLS).eq('user_id', g.userId).order('created_at', { ascending: false }).limit(40)
  if (mine.error) return NextResponse.json({ error: tableMissing(mine.error.message) ? MISSING_WORDS : mine.error.message }, { status: 500 })
  const [library, allowance] = await Promise.all([libraryOf(admin, g.userId, brandId), allowanceOf(admin, g.userId, g.tier)])
  return NextResponse.json({ beds: mine.data || [], library: library.beds, usedForBrand: library.usedForBrand, libraryReady: library.ready, allowance, allowanceWords: musicAllowanceWords(allowance) })
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
    // THE MONTH'S NEW TRACKS: none made past what is left, said with when more come.
    const allowance = await allowanceOf(admin, g.userId, g.tier)
    if (allowance.left !== null && allowance.left <= 0) return NextResponse.json({ error: musicAllowanceWords(allowance), allowanceFull: true, allowance }, { status: 429 })
    // The table first, so a missing migration costs nothing.
    const probe = await admin.from('music_beds').select('id').limit(1)
    if (probe.error) return NextResponse.json({ error: tableMissing(probe.error.message) ? MISSING_WORDS : probe.error.message }, { status: 500 })

    const model = BED_MODELS[ask.model]
    const prompt = bedPrompt(ask)
    let audioUrl = ''
    let seed: number | null = null
    try {
      const r = await fal.subscribe(model.id, {
        input: engineInput(ask.model, prompt, ask.seconds),
        abortSignal: AbortSignal.timeout(110_000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = ((r as any)?.data ?? r) as { seed?: unknown }
      audioUrl = audioUrlOf(data)
      seed = typeof data?.seed === 'number' ? data.seed : null
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      return NextResponse.json({ error: /abort|timeout/i.test(msg) ? 'Stable Audio took too long. Try again, or a shorter length.' : `Stable Audio did not make the track${msg ? `: ${msg.slice(0, 160)}` : ''}.` }, { status: 502 })
    }
    if (!audioUrl) return NextResponse.json({ error: 'Stable Audio answered without a track. Try again.' }, { status: 502 })
    recordUsage({ userId: g.userId, tier: g.tier, feature: 'music_bed', model: model.usage, images: 1 })

    // Kept in MVP's own storage: fal's link does not last.
    // Stable Audio 2.5 answers with a wav; the others with an mp3.
    const id = crypto.randomUUID()
    const wav = /\.wav(\?|$)/i.test(audioUrl)
    const path = `music-beds/${g.userId}/${id}.${wav ? 'wav' : 'mp3'}`
    let url: string
    try {
      const a = await fetch(audioUrl, { signal: AbortSignal.timeout(45_000) })
      if (!a.ok) throw new Error(`fal answered ${a.status}`)
      const buf = Buffer.from(await a.arrayBuffer())
      const up = await admin.storage.from(BUCKET).upload(path, buf, { contentType: wav ? 'audio/wav' : 'audio/mpeg', upsert: true })
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
  // In the MVP music library or kept to its maker (migration 478).
  if (action === 'share') {
    const shared = body.shared === true
    const { data, error } = await admin.from('music_beds').update({ shared }).eq('id', id).select(`${COLS}, shared`).single()
    if (error) return NextResponse.json({ error: /shared/.test(error.message) ? 'Sharing tracks needs migration 478 (the shared music library). Run it in the Supabase SQL editor, then try again.' : error.message }, { status: /shared/.test(error.message) ? 503 : 500 })
    return NextResponse.json({ bed: data })
  }
  if (action === 'reject') {
    const { data, error } = await admin.from('music_beds').update({ status: 'rejected' }).eq('id', id).select(COLS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ bed: data })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
