// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Live follow-up: the calls that leave MVP (video service, Whisper,
// Claude). Each one returns the reason it failed, so the page can say what
// went wrong instead of showing an empty result. See lib/live-followup.ts.

import { fal } from '@fal-ai/client'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { cuesToTimestampedText } from '@/lib/shorts-transcript'
import type { TranscriptCue } from '@/lib/shorts-types'
import { buildMatchPrompt, parseMoments, type LiveMoment, type LiveProduct } from '@/lib/live-followup'

type Fail = { ok: false; error: string }

function ingestBase(): string | null {
  return (process.env.YOUTUBE_INGEST_URL || '').replace(/\/+$/, '') || null
}
function ingestHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.YOUTUBE_INGEST_SECRET ? { 'x-ingest-secret': process.env.YOUTUBE_INGEST_SECRET } : {}),
  }
}
async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({})) as { error?: string }
  return j?.error || `HTTP ${res.status}`
}

/** The replay's audio, small enough to transcribe. */
export async function streamAudio(streamUrl: string, userId: string): Promise<{ ok: true; url: string; durationSec: number | null } | Fail> {
  const base = ingestBase()
  if (!base) return { ok: false, error: 'The video service is not set up (YOUTUBE_INGEST_URL).' }
  try {
    const res = await fetch(`${base}/stream-audio`, {
      method: 'POST', headers: ingestHeaders(), body: JSON.stringify({ url: streamUrl, userId }), signal: AbortSignal.timeout(290_000),
    })
    if (res.status === 404) return { ok: false, error: 'The video service has not been updated with Live follow-up yet. Redeploy it and try again.' }
    if (!res.ok) return { ok: false, error: `The video service could not read the replay: ${await errorOf(res)}` }
    const j = await res.json() as { url?: string; durationSeconds?: number | null }
    if (!j.url) return { ok: false, error: 'The video service returned no audio.' }
    return { ok: true, url: j.url, durationSec: Number.isFinite(Number(j.durationSeconds)) ? Number(j.durationSeconds) : null }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'TimeoutError' ? 'Reading the replay took too long.' : `Could not reach the video service: ${String(e).slice(0, 160)}` }
  }
}

/** Word-timed transcript of the audio (Whisper on fal). */
export async function transcribeLive(audioUrl: string, userId: string, tier: string | null): Promise<{ ok: true; cues: TranscriptCue[] } | Fail> {
  if (!process.env.FAL_KEY) return { ok: false, error: 'Transcription is not set up (FAL_KEY).' }
  try {
    fal.config({ credentials: process.env.FAL_KEY })
    const result = await fal.subscribe('fal-ai/whisper', {
      input: { audio_url: audioUrl, task: 'transcribe', chunk_level: 'word', language: 'en' },
    } as never)
    recordUsage({ userId, tier, feature: 'live_followup_transcribe', model: 'fal-whisper', images: 1 })
    const data = ((result as { data?: unknown })?.data ?? result) as { chunks?: Array<{ timestamp?: [number | null, number | null]; text?: string }> }
    const cues: TranscriptCue[] = []
    for (const c of Array.isArray(data?.chunks) ? data.chunks : []) {
      const start = Number(c?.timestamp?.[0])
      let end = Number(c?.timestamp?.[1])
      const text = String(c?.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isFinite(start) || start < 0) continue
      if (!Number.isFinite(end) || end <= start) end = start + 1
      cues.push({ start, end, text })
    }
    if (!cues.length) return { ok: false, error: 'The transcript came back empty. Is there speech in the replay?' }
    return { ok: true, cues: cues.sort((a, b) => a.start - b.start) }
  } catch (e) {
    return { ok: false, error: `Transcription failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` }
  }
}

/** Where each product was shown. Products Claude could not place are returned
 *  as `missing`, by name, never dropped. */
export async function matchMoments(products: LiveProduct[], cues: TranscriptCue[], durationSec: number | null, userId: string, tier: string | null)
  : Promise<{ ok: true; moments: LiveMoment[]; missing: LiveProduct[] } | Fail> {
  if (!products.length) return { ok: false, error: 'No products to look for: pick the show plan, or the replay page listed none.' }
  const transcript = cuesToTimestampedText(cues, 120_000)
  try {
    const model = 'claude-haiku-4-5-20251001'
    // IN GROUPS OF 20. One reply for every product ran past its length on a
    // Live with fifty or more, the cut-off JSON read as no moments at all, and
    // the screen said "Found 0 products" as if the plan were wrong. A reply
    // that is still cut off is said, never read as an empty answer.
    const moments: LiveMoment[] = []
    for (let i = 0; i < products.length; i += 20) {
      const group = products.slice(i, i + 20)
      const { system, user } = buildMatchPrompt(group, transcript)
      const msg = await createAnthropicClient().messages.create({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] })
      recordAnthropicUsage(msg, { userId, tier, feature: 'live_followup_match', model })
      if (msg.stop_reason === 'max_tokens') {
        return { ok: false, error: 'The answer about where each product was shown was cut off, so nothing was changed. Try again.' }
      }
      const raw = (msg.content[0] as { type: string; text?: string }).text || ''
      moments.push(...parseMoments(raw, group, durationSec))
    }
    moments.sort((a, b) => a.startSec - b.startSec)
    const found = new Set(moments.map((m) => m.asin))
    return { ok: true, moments, missing: products.filter((p) => !found.has(p.asin)) }
  } catch (e) {
    return { ok: false, error: `Finding the products in the replay failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` }
  }
}

/** One still from the stream, for framing a clip. */
export async function liveFrame(streamUrl: string, atSec: number, userId: string): Promise<{ ok: true; url: string; aspect: number | null } | Fail> {
  const base = ingestBase()
  if (!base) return { ok: false, error: 'The video service is not set up (YOUTUBE_INGEST_URL).' }
  try {
    const res = await fetch(`${base}/frame`, { method: 'POST', headers: ingestHeaders(), body: JSON.stringify({ url: streamUrl, atSec, userId }), signal: AbortSignal.timeout(75_000) })
    if (res.status === 404) return { ok: false, error: 'The video service has not been updated with framing yet. Redeploy it and try again.' }
    if (!res.ok) return { ok: false, error: `No frame could be read: ${await errorOf(res)}` }
    const j = await res.json() as { url?: string; width?: number | null; height?: number | null }
    if (!j.url) return { ok: false, error: 'The video service returned no frame.' }
    return { ok: true, url: j.url, aspect: j.width && j.height ? j.width / j.height : null }
  } catch (e) {
    return { ok: false, error: `Could not reach the video service: ${String(e).slice(0, 160)}` }
  }
}

/** Where the speaker's face is across the frame (0 left, 1 right), read by
 *  Claude from one still. Null when nobody clear is on screen. */
export async function findSpeaker(frameUrl: string, userId: string, tier: string | null): Promise<{ ok: true; faceX: number | null; people: number } | Fail> {
  try {
    const img = await fetch(frameUrl, { signal: AbortSignal.timeout(20_000) })
    if (!img.ok) return { ok: false, error: `The frame could not be loaded (${img.status}).` }
    const data = Buffer.from(await img.arrayBuffer()).toString('base64')
    const model = 'claude-haiku-4-5-20251001'
    const msg = await createAnthropicClient().messages.create({
      model, max_tokens: 200,
      system: 'You locate the person presenting in a livestream frame. Return STRICT JSON only: {"faceX": number, "people": number}. faceX is the horizontal centre of the face of the person presenting or speaking, from 0 (left edge) to 1 (right edge). If two people present side by side with equal weight, give the point between their faces. If no face is visible, faceX is null. people is how many people are visible.',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: 'Where is the presenter? JSON only.' },
      ] }],
    })
    recordAnthropicUsage(msg, { userId, tier, feature: 'live_followup_frame', model })
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { faceX?: unknown; people?: unknown }
    const fx = j.faceX == null ? null : Number(j.faceX)
    return { ok: true, faceX: fx != null && Number.isFinite(fx) && fx >= 0 && fx <= 1 ? fx : null, people: Number(j.people) || 0 }
  } catch (e) {
    return { ok: false, error: `Finding the speaker failed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }
  }
}

/** One vertical clip, cut straight from the stream with burned captions,
 *  the 9:16 window at `cropX` across the frame (centre when unset). */
export async function renderLiveClip(streamUrl: string, startSec: number, endSec: number, words: Array<{ startSec: number; endSec: number; text: string }>, userId: string, framing: { cropX?: number | null; layout?: 'center' | 'split' | null } = {})
  : Promise<{ ok: true; url: string } | Fail> {
  const base = ingestBase()
  if (!base) return { ok: false, error: 'The video service is not set up (YOUTUBE_INGEST_URL).' }
  try {
    const res = await fetch(`${base}/render-short`, {
      method: 'POST', headers: ingestHeaders(),
      body: JSON.stringify({ videoUrl: streamUrl, stream: true, startSec, endSec, words, userId, reframe: framing.layout === 'split' ? 'split' : 'center', ...(framing.cropX != null ? { cropX: framing.cropX } : {}) }),
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.ok) return { ok: false, error: `The clip could not be cut: ${await errorOf(res)}` }
    const j = await res.json() as { url?: string }
    return j.url && /^https:\/\//i.test(j.url) ? { ok: true, url: j.url } : { ok: false, error: 'The video service returned no clip.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'TimeoutError' ? 'Cutting the clip took too long.' : `Could not reach the video service: ${String(e).slice(0, 160)}` }
  }
}
