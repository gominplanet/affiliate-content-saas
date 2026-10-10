// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHERE A CLIP STARTS AND ENDS, AND WHAT IS CUT OUT OF IT (Seb, 2026-10-10:
// "im not a huge fan of the clips it produces").
//
// Clips started and ended mid-sentence. The planner snapped to "the transcript
// piece the time falls in", and with Whisper a piece is ONE WORD, so a clip
// could open on "...and that's why" and stop before the payoff. Here a clip
// opens on the first word of a sentence and closes after the last word of one,
// with a breath of room either side so no word is clipped.
//
// And "Trim silences" was a checkbox the render ignored. silenceCuts works out
// which stretches of the clip to keep, and moves every caption word onto the
// shortened timeline so the words still land on the mouth.
//
// Pure, so both are tested (scripts/test-clip-engine).

import type { TranscriptCue } from '@/lib/shorts-types'

/** A pause this long ends a thought even without a full stop (captions from
 *  YouTube and some Whisper output have no punctuation). */
export const SENTENCE_GAP_SEC = 0.7
/** How far back MVP will move a start to reach the sentence's first word.
 *  Further than this, the clip starts at the NEXT sentence instead. */
const MAX_PULL_BACK_SEC = 6
const PAD_BEFORE = 0.12
const PAD_AFTER = 0.3

export interface SentenceUnit { start: number; end: number; first: number; last: number }

/** The transcript as whole sentences: indexes into `cues` plus their times. */
export function sentenceUnits(cues: TranscriptCue[]): SentenceUnit[] {
  const units: SentenceUnit[] = []
  let first = 0
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1]
    const ends = /[.!?]["'”’)]*$/.test(cues[i].text.trim())
    const pause = next ? next.start - cues[i].end > SENTENCE_GAP_SEC : true
    if (ends || pause || !next) {
      units.push({ start: cues[first].start, end: cues[i].end, first, last: i })
      first = i + 1
    }
  }
  return units
}

/**
 * Snap a wanted window to sentence edges inside [minSec, maxSec]. Returns null
 * when no sentence-clean window fits (one very long run-on sentence), and the
 * caller falls back to word edges.
 */
export function snapToSentences(
  cues: TranscriptCue[],
  wantStart: number,
  wantEnd: number,
  minSec: number,
  maxSec: number,
): { start: number; end: number } | null {
  if (!cues.length) return null
  const units = sentenceUnits(cues)
  // The sentence the start falls in, else the first that starts after it.
  let si = units.findIndex((u) => u.start <= wantStart && u.end > wantStart)
  if (si >= 0 && wantStart - units[si].start > MAX_PULL_BACK_SEC) si += 1
  if (si < 0) si = units.findIndex((u) => u.start >= wantStart)
  if (si < 0 || si >= units.length) return null

  const start = units[si].start
  // Every sentence end that gives a legal length; the one nearest the wanted end wins.
  let best: number | null = null
  for (let j = si; j < units.length; j++) {
    const len = units[j].end - start
    if (len > maxSec + 0.5) break
    if (len < minSec - 0.5) continue
    if (best === null || Math.abs(units[j].end - wantEnd) < Math.abs(units[best].end - wantEnd)) best = j
  }
  if (best === null) return null

  // A breath either side, never reaching into the neighbouring word.
  const prevEnd = units[si].first > 0 ? cues[units[si].first - 1].end : 0
  const nextStart = units[best].last + 1 < cues.length ? cues[units[best].last + 1].start : units[best].end + PAD_AFTER
  const s = Math.max(prevEnd, start - PAD_BEFORE, 0)
  const e = Math.min(nextStart, units[best].end + PAD_AFTER)
  return { start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100 }
}

// ── Trim silences ────────────────────────────────────────────────────────────

/** A gap between words longer than this is dead air. */
export const SILENCE_MIN_SEC = 0.5
/** What is left of a cut gap, so speech does not run together. */
export const SILENCE_KEEP_SEC = 0.18

export interface ClipWord { startSec: number; endSec: number; text: string; hl?: boolean }

/**
 * The stretches of a clip to keep (clip-relative seconds) and the caption words
 * moved onto the shortened timeline. A clip with no gap worth cutting comes back
 * as one segment and unchanged words.
 */
export function silenceCuts(words: ClipWord[], clipLen: number): { segments: Array<[number, number]>; words: ClipWord[]; savedSec: number } {
  const sorted = [...words].filter((w) => Number.isFinite(w.startSec) && Number.isFinite(w.endSec)).sort((a, b) => a.startSec - b.startSec)
  const half = SILENCE_KEEP_SEC / 2
  // Holes to remove: [from, to] on the clip timeline.
  const holes: Array<[number, number]> = []
  // Lead-in silence before the first word, and after the last.
  if (sorted.length && sorted[0].startSec > SILENCE_MIN_SEC) holes.push([0, sorted[0].startSec - half])
  for (let i = 1; i < sorted.length; i++) {
    const gapStart = sorted[i - 1].endSec
    const gapEnd = sorted[i].startSec
    if (gapEnd - gapStart > SILENCE_MIN_SEC) holes.push([gapStart + half, gapEnd - half])
  }
  const lastEnd = sorted.length ? sorted[sorted.length - 1].endSec : clipLen
  if (clipLen - lastEnd > SILENCE_MIN_SEC) holes.push([lastEnd + half * 2, clipLen])

  const segments: Array<[number, number]> = []
  let pos = 0
  for (const [a, b] of holes) {
    if (a > pos) segments.push([round(pos), round(a)])
    pos = Math.max(pos, b)
  }
  if (clipLen > pos) segments.push([round(pos), round(clipLen)])

  const removedBefore = (t: number) => holes.reduce((n, [a, b]) => n + (t >= b ? b - a : t > a ? t - a : 0), 0)
  const moved = sorted.map((w) => ({ ...w, startSec: round(w.startSec - removedBefore(w.startSec)), endSec: round(w.endSec - removedBefore(w.endSec)) }))
  const savedSec = round(holes.reduce((n, [a, b]) => n + (b - a), 0))
  return { segments, words: moved, savedSec }
}

const round = (n: number) => Math.round(n * 100) / 100
