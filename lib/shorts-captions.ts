// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Caption/subtitle math for Shorts Studio. Pure functions (no I/O) so they're
 * unit-tested directly — a timing bug here means subtitles that drift off the
 * words, which is the one thing that makes a Short look amateur.
 *
 * Everything a clip renders is CLIP-RELATIVE: 0 = the first frame of the clip.
 * Cloudinary burns each chunk as a time-boxed text overlay (so_/eo_), and those
 * offsets are measured from the trimmed clip's start, not the source video's.
 */
import type { TranscriptCue, CaptionChunk } from '@/lib/shorts-types'

/** Round to 1 decimal — Cloudinary time offsets are fine at 0.1s and it keeps
 *  the delivery URL short. */
function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Take the source-timeline cues overlapping [startSec, endSec] and return them
 * re-based to clip-relative seconds (0 = startSec), clipped to the window.
 */
export function sliceCuesToWindow(
  cues: TranscriptCue[],
  startSec: number,
  endSec: number,
): TranscriptCue[] {
  if (endSec <= startSec) return []
  const out: TranscriptCue[] = []
  for (const c of cues) {
    if (c.end <= startSec || c.start >= endSec) continue // no overlap
    const s = Math.max(c.start, startSec) - startSec
    const e = Math.min(c.end, endSec) - startSec
    if (e - s < 0.05) continue
    out.push({ start: r1(s), end: r1(e), text: c.text })
  }
  return out
}

// "Power words" a viewer's eye should snap to — numbers, money, and high-emphasis
// terms. The render service colors these in the burned captions (Opus/Hormozi
// style), so a word only needs to be FLAGGED here; the coloring happens there.
const POWER_WORDS = new Set([
  'best', 'worst', 'never', 'always', 'free', 'secret', 'most', 'first', 'only',
  'stop', 'warning', 'huge', 'insane', 'crazy', 'biggest', 'new', 'now', 'proven',
  'guaranteed', 'instantly', 'fast', 'easy', 'worth', 'save', 'wrong', 'mistake',
  'nobody', 'everyone', 'exactly', 'literally', 'game', 'changer', 'game-changer',
])

/** Should this caption word be highlighted (accent color) in the burned
 *  captions? True for numbers / %, / $ amounts, ALL-CAPS emphasis (≥3 chars),
 *  and known power words. Punctuation-insensitive. Pure + deterministic. */
export function isPowerWord(text: string): boolean {
  const raw = (text || '').trim()
  if (!raw) return false
  if (/[0-9]/.test(raw) || /[$%]/.test(raw)) return true            // "50%", "$29", "3x"
  const core = raw.replace(/[^A-Za-z]/g, '')
  if (core.length >= 3 && core === core.toUpperCase()) return true   // shouted emphasis
  return POWER_WORDS.has(core.toLowerCase())
}

/** True when the cues are WORD-level (Whisper chunk_level:'word') — most cues
 *  are a single token. Word-level cues carry real per-word timings, so we group
 *  them into lines instead of evenly splitting a phrase. */
function isWordLevel(cues: TranscriptCue[]): boolean {
  if (cues.length < 4) return false
  let singles = 0
  for (const c of cues) if (c.text.trim().split(/\s+/).length <= 1) singles++
  return singles / cues.length > 0.6
}

/** Group word-level cues into short caption lines timed to the ACTUAL words:
 *  line window = [first word start, last word end]. Breaks on maxWords or a
 *  speech pause (`gapSec`) so lines end naturally. This is the on-the-beat path. */
function groupWordsIntoLines(words: TranscriptCue[], maxWords: number, gapSec: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let cur: TranscriptCue[] = []
  const flush = () => {
    if (!cur.length) return
    const text = cur.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim()
    if (text) chunks.push({ startSec: r1(cur[0].start), endSec: r1(Math.max(cur[cur.length - 1].end, cur[0].start + 0.2)), text })
    cur = []
  }
  for (const w of words) {
    if (cur.length) {
      const gap = w.start - cur[cur.length - 1].end
      // End the line on a full group or a real pause, or when punctuation ends it.
      if (cur.length >= maxWords || gap > gapSec || /[.!?]$/.test(cur[cur.length - 1].text)) flush()
    }
    cur.push(w)
  }
  flush()
  return chunks
}

/**
 * Break clip-relative cues into short, readable caption chunks — the punchy
 * ≤N-word lines that read well on a phone. WORD-level cues are grouped by their
 * real timings (on the beat); phrase-level cues fall back to an even split of
 * the phrase's span. Output is monotonic, non-overlapping, and capped so the
 * Cloudinary transform URL stays bounded.
 */
export function buildCaptionChunks(
  windowCues: TranscriptCue[],
  opts: { maxWords?: number; maxChunks?: number } = {},
): CaptionChunk[] {
  const wordLevel = isWordLevel(windowCues)
  // Punchier lines for word-level (vidIQ-style ≤3 words); a touch longer when we
  // only have phrase timings and must approximate.
  const maxWords = Math.max(1, opts.maxWords ?? (wordLevel ? 3 : 5))
  const maxChunks = Math.max(1, opts.maxChunks ?? 40)

  const chunks: CaptionChunk[] = wordLevel
    ? groupWordsIntoLines(windowCues, maxWords, 0.6)
    : []
  if (!wordLevel) for (const cue of windowCues) {
    const words = cue.text.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    const span = Math.max(0.1, cue.end - cue.start)
    const groups = Math.ceil(words.length / maxWords)
    const per = span / groups
    for (let g = 0; g < groups; g++) {
      const text = words.slice(g * maxWords, (g + 1) * maxWords).join(' ')
      if (!text) continue
      const start = r1(cue.start + g * per)
      const end = r1(cue.start + (g + 1) * per)
      chunks.push({ startSec: start, endSec: Math.max(end, start + 0.1), text })
    }
  }

  // Enforce monotonic, non-overlapping windows (rounding can nudge them).
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].startSec < chunks[i - 1].endSec) chunks[i].startSec = chunks[i - 1].endSec
    if (chunks[i].endSec <= chunks[i].startSec) chunks[i].endSec = r1(chunks[i].startSec + 0.3)
  }

  // Cap the count by merging the tail if a very long clip overflows — never
  // silently drop captions off the end of the clip.
  if (chunks.length > maxChunks) {
    const kept = chunks.slice(0, maxChunks - 1)
    const rest = chunks.slice(maxChunks - 1)
    kept.push({
      startSec: rest[0].startSec,
      endSec: rest[rest.length - 1].endSec,
      text: rest.map(c => c.text).join(' '),
    })
    return kept
  }
  return chunks
}

/** Convenience: source cues + a clip window → burn-ready clip-relative chunks. */
export function captionsForClip(
  cues: TranscriptCue[],
  startSec: number,
  endSec: number,
  opts?: { maxWords?: number; maxChunks?: number },
): CaptionChunk[] {
  return buildCaptionChunks(sliceCuesToWindow(cues, startSec, endSec), opts)
}

/** Seconds → SRT timestamp `HH:MM:SS,mmm`. */
function srtStamp(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(millis, 3)}`
}

/** Render clip-relative chunks as an SRT string (clip-relative timings). Kept
 *  for a future Cloudinary `l_subtitles` path and for tests. */
export function chunksToSrt(chunks: CaptionChunk[]): string {
  return chunks
    .map((c, i) => `${i + 1}\n${srtStamp(c.startSec)} --> ${srtStamp(c.endSec)}\n${c.text}`)
    .join('\n\n')
}
