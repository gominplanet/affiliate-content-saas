// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Text-to-speech provider abstraction for Storefront Sync dubs (and any future
// voiceover work). ElevenLabs is the preferred engine: its multilingual model
// is far more natural than a generic TTS, and it supports per-creator voice
// cloning so a dub can sound like the creator (MVP's "sounds like you" promise).
// When ELEVENLABS_API_KEY isn't set we fall back to OpenAI TTS, which works with
// the key we already have — so the feature ships now and upgrades with no rework.

import { createOpenAIService } from '@/services/openai'

export interface SpeechResult { buffer: Buffer; contentType: string }

/** Which engine will run, for logging / UI copy. */
export function ttsProvider(): 'elevenlabs' | 'openai' | null {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return null
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
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' }
}

async function openaiSpeech(text: string): Promise<SpeechResult> {
  const buffer = await createOpenAIService().synthesizeSpeech(text)
  return { buffer, contentType: 'audio/mpeg' }
}

/** Synthesize speech from already-translated text. The engine detects the
 *  language from the text, so pass the target-language script. Returns null when
 *  no provider is configured. `voiceId` selects a specific (e.g. cloned) voice
 *  on providers that support it. */
export async function synthesizeSpeech(text: string, opts?: { voiceId?: string }): Promise<SpeechResult | null> {
  const provider = ttsProvider()
  if (!provider || !text.trim()) return null
  if (provider === 'elevenlabs') return elevenSpeech(text, opts?.voiceId)
  return openaiSpeech(text)
}
