// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Text-to-speech provider abstraction for Storefront Sync dubs (and any future
// voiceover work). ElevenLabs is the preferred engine: its multilingual model
// is far more natural than a generic TTS, and it supports per-creator voice
// cloning so a dub can sound like the creator (MVP's "sounds like you" promise).
// When ELEVENLABS_API_KEY isn't set we fall back to OpenAI TTS, which works with
// the key we already have — so the feature ships now and upgrades with no rework.

import { createOpenAIService } from '@/services/openai'

export type TtsEngine = 'elevenlabs' | 'openai'
export interface SpeechResult { buffer: Buffer; contentType: string; engine: TtsEngine }

/** True when at least one TTS engine is configured. */
export function ttsConfigured(): boolean {
  return !!(process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY)
}

/** True when ElevenLabs (the cloned-voice / premium engine) is available. */
export function elevenConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY
}

// A neutral, well-supported multilingual default voice. A creator's own cloned
// voice id (stored per user, future) overrides this via `voiceId`.
const ELEVEN_DEFAULT_VOICE = process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'

async function elevenSpeech(text: string, voiceId?: string): Promise<SpeechResult> {
  const key = process.env.ELEVENLABS_API_KEY as string
  const voice = voiceId || ELEVEN_DEFAULT_VOICE
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 5000), model_id: ELEVEN_MODEL }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg', engine: 'elevenlabs' }
}

async function openaiSpeech(text: string): Promise<SpeechResult> {
  const buffer = await createOpenAIService().synthesizeSpeech(text)
  return { buffer, contentType: 'audio/mpeg', engine: 'openai' }
}

/**
 * Synthesize a dub from already-translated text. Two lanes:
 *   - `voiceId` set (the creator's cloned voice) → ElevenLabs, the premium
 *     "sounds like you" engine. This is the bounded, higher-cost path.
 *   - no `voiceId` → OpenAI TTS, the standard engine (~7x cheaper), so dubbing
 *     every geo on every video stays affordable.
 * Falls back to whichever single engine is configured. Returns null when none
 * is, or the text is empty. The result reports which engine actually ran.
 */
export async function synthesizeSpeech(text: string, opts?: { voiceId?: string }): Promise<SpeechResult | null> {
  if (!text.trim()) return null
  const hasEleven = !!process.env.ELEVENLABS_API_KEY
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  // Cloned voice → ElevenLabs (premium).
  if (opts?.voiceId && hasEleven) return elevenSpeech(text, opts.voiceId)
  // Standard dub → OpenAI (cheap); fall back to an ElevenLabs default voice only
  // when OpenAI isn't configured.
  if (hasOpenAI) return openaiSpeech(text)
  if (hasEleven) return elevenSpeech(text)
  return null
}
