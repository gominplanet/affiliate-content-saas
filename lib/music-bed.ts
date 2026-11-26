// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MUSIC BEDS (Seb, 2026-11-26: "it'd be great if we could actually have the
// user tick a few boxes in terms of mood and tempo and style, and then be able
// to preview it and accept"). A bed is made to order by Stable Audio 3 on fal
// at the length the video needs, so it never has to be trimmed.
//
// Why Stable Audio: Stability's Community License lets a business under $1M a
// year use what it makes commercially, and fal's page for the Medium model says
// it was "trained on fully licensed data for safe commercial use". Epidemic
// Sound was ruled out (Seb: too complicated for ads that brands run on Meta and
// TikTok).
//
// The rules from Seb's own production notes:
//   - no voices, ever: no lyrics, no talking, no vocal chops. The melody is put
//     on instruments in the prompt, and every track is transcribed: varied
//     words mean voices, and that track is never offered;
//   - styles rotate so neighbouring videos differ, and never "8-bit" (the old
//     synth beds were rejected as that).
//
// WHAT FAILURE LOOKS LIKE: a voice check that could not run says so, and that
// track cannot be accepted until it is checked; it never reads as clean.
//
// Pure, so it is tested (scripts/test-music-bed.ts).

export type BedModel = 'small' | 'medium'
export const BED_MODELS: Record<BedModel, { id: string; name: string; maxSec: number; usd: number; usage: string; says: string }> = {
  small: { id: 'fal-ai/stable-audio-3/small/music/text-to-audio', name: 'Small', maxSec: 120, usd: 0.0217, usage: 'stable-audio-3-small', says: 'Made for music, up to 2 minutes' },
  medium: { id: 'fal-ai/stable-audio-3/medium/text-to-audio', name: 'Medium', maxSec: 380, usd: 0.0376, usage: 'stable-audio-3-medium', says: 'Fuller sound, trained on licensed music' },
}

export interface Choice { id: string; label: string; words: string }

export const MOODS: Choice[] = [
  { id: 'upbeat', label: 'Upbeat', words: 'upbeat, positive, feel-good' },
  { id: 'calm', label: 'Calm', words: 'calm, relaxed, gentle' },
  { id: 'warm', label: 'Warm', words: 'warm, cozy, heartfelt' },
  { id: 'confident', label: 'Confident', words: 'confident, bold, driving' },
  { id: 'playful', label: 'Playful', words: 'playful, quirky, light-hearted' },
  { id: 'inspiring', label: 'Inspiring', words: 'inspiring, uplifting, hopeful' },
  { id: 'dreamy', label: 'Dreamy', words: 'dreamy, airy, soft' },
  { id: 'luxe', label: 'Luxe', words: 'sleek, elegant, premium' },
]

export const TEMPOS: Array<Choice & { bpm: number }> = [
  { id: 'slow', label: 'Slow', words: 'slow tempo', bpm: 76 },
  { id: 'medium', label: 'Medium', words: 'mid tempo', bpm: 100 },
  { id: 'fast', label: 'Fast', words: 'fast tempo', bpm: 124 },
]

export const STYLES: Choice[] = [
  { id: 'pop', label: 'Pop', words: 'modern pop instrumental, clean drums, bright guitar and keys' },
  { id: 'acoustic', label: 'Acoustic', words: 'acoustic guitar, light hand percussion, soft piano' },
  { id: 'lofi', label: 'Lo-fi', words: 'lo-fi hip hop beat, mellow electric piano, soft vinyl texture' },
  { id: 'electronic', label: 'Electronic', words: 'smooth electronic, warm synth pads, tight modern beat' },
  { id: 'hiphop', label: 'Hip hop', words: 'hip hop instrumental, punchy drums, deep bass, piano loop' },
  { id: 'cinematic', label: 'Cinematic', words: 'cinematic strings and piano, soft percussion, building' },
  { id: 'funk', label: 'Funk', words: 'funk groove, slap bass, rhythm guitar, brass stabs' },
  { id: 'clean', label: 'Clean', words: 'clean modern background music, light piano and plucked strings' },
]

/** Up to two moods and two styles, one tempo. */
export const MAX_MOODS = 2
export const MAX_STYLES = 2
/** The shortest bed worth making. */
export const MIN_SECONDS = 5

/** Voices and the sounds Seb's beds were rejected for, never asked for. */
export const NEGATIVE_PROMPT = 'vocals, singing, voice, voices, speech, spoken word, talking, lyrics, rap, choir, humming, vocal chops, 8-bit, chiptune, video game music, distortion, low quality'

export interface BedAsk { moods: string[]; tempo: string; styles: string[]; seconds: number; model: BedModel }

const pick = (list: Choice[], ids: unknown, max: number): Choice[] => {
  const want = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  const out: Choice[] = []
  for (const id of want) { const c = list.find((x) => x.id === id); if (c && !out.includes(c) && out.length < max) out.push(c) }
  return out
}

/** A request from the page, read safely: an error in words, or the ask. Pure. */
export function readAsk(body: Record<string, unknown>): { ok: true; ask: BedAsk } | { ok: false; error: string } {
  const model: BedModel = body.model === 'medium' ? 'medium' : 'small'
  const moods = pick(MOODS, body.moods, MAX_MOODS)
  const styles = pick(STYLES, body.styles, MAX_STYLES)
  const tempo = TEMPOS.find((t) => t.id === body.tempo)
  const n = typeof body.seconds === 'number' ? body.seconds : Number(body.seconds)
  if (!moods.length) return { ok: false, error: 'Pick at least one mood.' }
  if (!tempo) return { ok: false, error: 'Pick a tempo.' }
  if (!styles.length) return { ok: false, error: 'Pick at least one style.' }
  if (!Number.isFinite(n) || n < MIN_SECONDS) return { ok: false, error: `Pick a length of at least ${MIN_SECONDS} seconds.` }
  const max = BED_MODELS[model].maxSec
  if (n > max) return { ok: false, error: `${BED_MODELS[model].name} makes up to ${max} seconds. Pick a shorter length or the other engine.` }
  return { ok: true, ask: { moods: moods.map((m) => m.id), tempo: tempo.id, styles: styles.map((s) => s.id), seconds: Math.round(n), model } }
}

/** The words Stable Audio is given: the styles, the moods, the tempo in BPM,
 *  and always instrumental with the melody on instruments. Pure. */
export function bedPrompt(ask: BedAsk): string {
  const styles = ask.styles.map((id) => STYLES.find((s) => s.id === id)?.words).filter(Boolean).join('; ')
  const moods = ask.moods.map((id) => MOODS.find((m) => m.id === id)?.words).filter(Boolean).join(', ')
  const tempo = TEMPOS.find((t) => t.id === ask.tempo)
  return `${styles}. ${moods}. ${tempo ? `${tempo.bpm} BPM, ${tempo.words}. ` : ''}Instrumental background music for a short product video, no vocals, the melody played on instruments, steady energy that sits under a voice, polished mix, ends cleanly.`
}

/** Words a transcriber invents over music, which are not voices. */
const MUSIC_GHOSTS = new Set(['thank', 'thanks', 'you', 'music', 'la', 'oh', 'ah', 'uh', 'um', 'mm', 'hmm', 'na', 'yeah', 'bye'])
/** This many different real words heard means someone is singing or talking. */
export const VOICE_WORDS = 4

/** Whether a track has voices, from what the transcriber heard. Varied words
 *  mean voices (Seb's rule); a ghost "thank you" over music does not. Pure. */
export function voiceVerdict(text: string): { verdict: 'clean' | 'voices'; heard: string[] } {
  const words = String(text || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => w.length > 1 && !MUSIC_GHOSTS.has(w))
  const heard = Array.from(new Set(words))
  return { verdict: heard.length >= VOICE_WORDS ? 'voices' : 'clean', heard: heard.slice(0, 12) }
}

export type VoiceCheck = 'clean' | 'voices' | 'unchecked'

/** What a bed's voice check says, in words for the page. Pure. */
export function voiceWords(check: VoiceCheck, heard: string[], error?: string | null): string {
  if (check === 'clean') return 'Checked: no voices.'
  if (check === 'voices') return `Voices heard (${heard.slice(0, 6).join(', ')}), so this one is not offered. Make another.`
  return `The voice check did not run${error ? ` (${error})` : ''}. Check it again before you accept it.`
}

/** Only a bed checked and clean can be accepted. Pure. */
export function canAccept(check: VoiceCheck, status: string): boolean {
  return check === 'clean' && status === 'preview'
}
