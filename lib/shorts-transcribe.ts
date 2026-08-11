// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Speech-to-text for Shorts Studio — the bold-style path.
 *
 * Instead of depending on YouTube's caption endpoints (blocked from cloud IPs,
 * and often missing), we transcribe the creator's OWN uploaded video with
 * Whisper (via fal.ai) and get word-accurate timestamps straight from the
 * audio. This is the RELIABLE source: it works for any video, captions or not,
 * and the file is one the creator explicitly uploaded (no YouTube pull).
 *
 * fal's whisper accepts an mp4 URL directly and returns segment chunks with
 * [start, end] timestamps in seconds — which map 1:1 to our TranscriptCue.
 */
import { fal } from '@fal-ai/client'
import type { TranscriptCue } from '@/lib/shorts-types'

if (process.env.FAL_KEY) {
  try { fal.config({ credentials: process.env.FAL_KEY }) } catch { /* client self-configures at call time */ }
}

const WHISPER_MODEL = 'fal-ai/whisper'

interface WhisperChunk { timestamp?: [number | null, number | null]; text?: string }

export function transcriptionConfigured(): boolean {
  return !!process.env.FAL_KEY
}

/**
 * Transcribe an audio/video URL (an uploaded mp4 works directly) into
 * timestamped cues. Returns [] on any failure or when FAL_KEY is unset, so the
 * caller degrades cleanly. Best-effort, never throws.
 */
export async function transcribeToCues(mediaUrl: string): Promise<TranscriptCue[]> {
  if (!mediaUrl || !process.env.FAL_KEY) return []
  try {
    const result = await fal.subscribe(WHISPER_MODEL, {
      input: {
        audio_url: mediaUrl,
        task: 'transcribe',
        // WORD-level chunks = one cue per spoken word with its own [start,end].
        // This is what makes captions land on the beat: the builder groups words
        // into short lines using their real timings instead of dividing a phrase
        // evenly (which drifts off the words). The clip-selection text merges
        // words back into lines, so the LLM prompt stays compact.
        chunk_level: 'word',
        language: 'en',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    // fal client v1 returns { data, requestId }; older shapes return the body
    // directly. Handle both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = ((result as any)?.data ?? result) as { chunks?: WhisperChunk[]; text?: string }
    const chunks = Array.isArray(data?.chunks) ? data.chunks : []

    const cues: TranscriptCue[] = []
    for (const c of chunks) {
      const start = Number(c?.timestamp?.[0])
      let end = Number(c?.timestamp?.[1])
      const text = (c?.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isFinite(start) || start < 0) continue
      // Whisper can return a null end on the final chunk — give it a 2s width.
      if (!Number.isFinite(end) || end <= start) end = start + 2
      cues.push({ start, end, text })
    }
    return cues.sort((a, b) => a.start - b.start)
  } catch {
    return []
  }
}
