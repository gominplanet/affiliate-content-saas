// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Timestamped transcript for Shorts Studio.
 *
 * The blog/metadata pipelines only need the transcript TEXT, so they flatten
 * `youtube-transcript` segments to a string. Shorts Studio needs the TIMINGS
 * too — they're what tells us where a clip starts and ends and when each
 * subtitle line shows. This module fetches the per-line cues and normalises
 * them to SECONDS.
 *
 * Unit gotcha: `youtube-transcript` has returned `offset`/`duration` in
 * milliseconds in some versions and seconds in others. Rather than pin to a
 * version's quirk, we DETECT the unit: no real caption line lasts 50+ seconds,
 * so if the median cue duration is huge the values must be milliseconds and we
 * scale by 1000. This stays correct across library upgrades.
 */
import { YoutubeTranscript } from 'youtube-transcript'
import type { TranscriptCue } from '@/lib/shorts-types'

interface RawSeg { text?: string; duration?: number; offset?: number }

/** Median of a numeric list (0 for empty). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Normalise raw segments to seconds-based cues. Exported for unit tests — the
 * ms-vs-seconds detection is the part most likely to silently break on a
 * dependency bump, so it's tested directly.
 */
export function normalizeCues(raw: RawSeg[]): TranscriptCue[] {
  const segs = (raw || []).filter(s => (s?.text ?? '').trim().length > 0)
  if (segs.length === 0) return []

  // Detect the unit from the median cue duration. Real spoken caption lines run
  // ~1–6s; in milliseconds that's ~1000–6000. A median > 50 can only be ms.
  const durations = segs.map(s => Number(s.duration) || 0).filter(d => d > 0)
  const scale = median(durations) > 50 ? 1000 : 1

  const cues: TranscriptCue[] = []
  for (const s of segs) {
    const start = (Number(s.offset) || 0) / scale
    const dur = (Number(s.duration) || 0) / scale
    if (!Number.isFinite(start) || start < 0) continue
    // Clamp a missing/absurd duration to a sane 2s so a cue always has width.
    const end = start + (dur > 0 && dur < 60 ? dur : 2)
    cues.push({ start, end, text: (s.text ?? '').replace(/\s+/g, ' ').trim() })
  }
  // Timestamps should already be monotonic, but sort defensively.
  return cues.sort((a, b) => a.start - b.start)
}

/**
 * Fetch the timestamped transcript for a YouTube video id. Returns [] on any
 * failure (no captions, IP-blocked scraper) so the caller degrades cleanly —
 * exactly like the blog/metadata transcript paths. Best-effort, no throw.
 */
export async function fetchTranscriptCues(youtubeVideoId: string): Promise<TranscriptCue[]> {
  if (!youtubeVideoId) return []
  try {
    const segs = (await YoutubeTranscript.fetchTranscript(youtubeVideoId, { lang: 'en' })) as RawSeg[]
    return normalizeCues(segs)
  } catch {
    try {
      // Retry without the language hint — some videos only expose an auto track
      // under a non-'en' code and the lang filter then returns nothing.
      const segs = (await YoutubeTranscript.fetchTranscript(youtubeVideoId)) as RawSeg[]
      return normalizeCues(segs)
    } catch {
      return []
    }
  }
}

/** SRT timestamp `HH:MM:SS,mmm` (or `.mmm`) → seconds. Returns NaN if unparseable. */
function srtStampToSec(stamp: string): number {
  const m = stamp.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/)
  if (!m) return NaN
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
}

/**
 * Parse a raw SRT string (from the YouTube Data API captions.download) into
 * timestamped cues. This is the RELIABLE, server-safe transcript source — the
 * official API isn't IP-blocked like the youtube-transcript scraper. Exported
 * and unit-tested because the timestamp parsing is exactly where an SRT-format
 * quirk would silently break clip windows.
 */
export function parseSrtCues(srt: string): TranscriptCue[] {
  if (!srt) return []
  const blocks = srt.replace(/\r/g, '').split(/\n\s*\n/)
  const cues: TranscriptCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim().length > 0)
    if (lines.length === 0) continue
    // Find the timing line (has "-->"); text is everything after it.
    const timingIdx = lines.findIndex(l => l.includes('-->'))
    if (timingIdx === -1) continue
    const [rawStart, rawEnd] = lines[timingIdx].split('-->')
    const start = srtStampToSec(rawStart || '')
    const end = srtStampToSec(rawEnd || '')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const text = lines.slice(timingIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** Flatten cues to plain text (for the planner's "full transcript" context and
 *  for caching back to youtube_videos.transcript). */
export function cuesToText(cues: TranscriptCue[]): string {
  return cues.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim()
}

/** A compact, timestamped rendering of the transcript for the LLM: one line per
 *  cue as `[mm:ss] text`. Capped to `maxChars` so a 2-hour video can't blow the
 *  prompt budget (we keep the START of the video, where hooks cluster). */
export function cuesToTimestampedText(cues: TranscriptCue[], maxChars = 16000): string {
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  let out = ''
  for (const c of cues) {
    const line = `[${fmt(c.start)}] ${c.text}\n`
    if (out.length + line.length > maxChars) break
    out += line
  }
  return out.trim()
}
