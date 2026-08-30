// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Shorts Studio planner — the "brain". Given the TIMESTAMPED transcript of a
 * long-form video, Claude picks the moments that stand alone as 15–30s vertical
 * Shorts and writes each one a hook + caption + hashtags. It does NOT write the
 * subtitles: those are lifted VERBATIM from the transcript (lib/shorts-captions)
 * for the picked window, which is what makes this the fact-grounded engine — a
 * Short can only ever say what the creator actually said on camera.
 *
 * Runs on the transcript alone (no video file), so planning works for every
 * user instantly; rendering the picked clips is a separate, opt-in step.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import type { TranscriptCue, ClipSuggestion } from '@/lib/shorts-types'
import { cuesToTimestampedText } from '@/lib/shorts-transcript'
import { sliceCuesToWindow } from '@/lib/shorts-captions'

const MODEL = 'claude-sonnet-4-6'
// Cheap first pass that scores where the good moments ARE, so the expensive
// Sonnet call only reads the strong windows instead of the whole transcript.
const HOTSPOT_MODEL = 'claude-haiku-4-5-20251001'
// Below this, the whole transcript is small enough that a hotspot pass adds
// latency + a Haiku call for no real token saving — feed it to Sonnet directly.
const LONG_VIDEO_SEC = 8 * 60
// Window size for the hotspot scan (~4 min chunks).
const HOTSPOT_WINDOW_SEC = 240

export interface PlanOpts {
  cues: TranscriptCue[]
  videoTitle: string
  niches?: string
  tone?: string
  /** The creator's trained voice block (fingerprint + LEARN profile) from
   *  lib/creator-voice. When set, the hooks and captions are written in their
   *  voice instead of the generic tone. Optional. */
  voiceBlock?: string
  /** How many clips to try to surface (clamped 1–10). */
  count?: number
  /** Clip length bounds in seconds. Defaults 15–30 (YouTube Shorts sweet spot). */
  minSec?: number
  maxSec?: number
  /** The source video's own description (from YouTube). Gives the model the
   *  product name + the creator's framing so hooks/captions/hashtags land the
   *  product, not just generic angles. */
  sourceDescription?: string
  /** "Find more Shorts": windows already surfaced in earlier runs. The planner
   *  skips hotspot windows covered by these and drops any clip that overlaps
   *  them, so a second pass never re-proposes the same moment. */
  excludeRanges?: Array<{ startSec: number; endSec: number }>
  telemetry?: { userId: string | null; tier: string | null }
}

interface Hotspot { startSec: number; endSec: number; score: number }

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

/** Cheap Haiku pass: split the transcript into ~4-min windows and score each for
 *  "contains a standalone Short moment". Lets the Sonnet pass read only the top
 *  windows on long videos — the #1 recurring planner token cost. */
async function hotspotScan(anthropic: Anthropic, cues: TranscriptCue[], opts: PlanOpts): Promise<Hotspot[]> {
  const videoEnd = cues[cues.length - 1].end
  const windows: Array<{ startSec: number; endSec: number; text: string }> = []
  for (let ws = 0; ws < videoEnd; ws += HOTSPOT_WINDOW_SEC) {
    const we = Math.min(ws + HOTSPOT_WINDOW_SEC, videoEnd)
    const wc = cues.filter(c => c.start >= ws && c.start < we)
    if (wc.length === 0) continue
    const text = wc.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 900)
    windows.push({ startSec: ws, endSec: we, text })
  }
  // Too few windows → nothing to prune; treat all as equally worth reading.
  if (windows.length <= 3) return windows.map(w => ({ startSec: w.startSec, endSec: w.endSec, score: 50 }))

  const list = windows.map((w, i) => `[${i}] ${mmss(w.startSec)}-${mmss(w.endSec)}: ${w.text}`).join('\n')
  const system = 'You score transcript windows for short-form video potential. Return ONLY a JSON array, nothing else.'
  const user =
    `A long video's transcript is split into numbered windows. Score EACH window 0–100 for how likely it ` +
    `contains a standalone 15–30s Short moment (a strong hook, a surprising number/result, a mini-story with a ` +
    `payoff, a hot take, a before/after, or a crisp tip that stands alone). Be decisive — spread the scores.\n\n` +
    `Return ONLY: [{"i":0,"score":72}, ...] with an entry for EVERY window index.\n\nWINDOWS:\n${list}`
  try {
    const msg = await anthropic.messages.create({ model: HOTSPOT_MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] })
    try {
      recordAnthropicUsage(msg, { userId: opts.telemetry?.userId ?? null, tier: opts.telemetry?.tier ?? null, feature: 'shorts_hotspot', model: HOTSPOT_MODEL })
    } catch { /* telemetry best-effort */ }
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
    const m = text.match(/\[[\s\S]*\]/)
    const scores = new Map<number, number>()
    if (m) {
      const arr = JSON.parse(m[0]) as Array<{ i?: number; score?: number }>
      for (const r of arr) {
        if (typeof r.i === 'number' && typeof r.score === 'number') scores.set(r.i, Math.max(0, Math.min(100, r.score)))
      }
    }
    return windows.map((w, i) => ({ startSec: w.startSec, endSec: w.endSec, score: scores.get(i) ?? 40 }))
  } catch {
    // Haiku failed → don't block planning; treat every window as readable.
    return windows.map(w => ({ startSec: w.startSec, endSec: w.endSec, score: 50 }))
  }
}

interface RawClip {
  startSec?: number
  endSec?: number
  hook?: string
  caption?: string
  reason?: string
  score?: number
  hashtags?: string[]
}

function parseJSONArray(raw: string): RawClip[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** Snap a requested window to real cue boundaries and clamp it to the clip
 *  length bounds + the video's actual end. Starting/ending on a cue edge keeps
 *  the clip from opening or closing mid-word. */
function snapWindow(
  cues: TranscriptCue[],
  wantStart: number,
  wantEnd: number,
  minSec: number,
  maxSec: number,
): { start: number; end: number } | null {
  if (cues.length === 0) return null
  const videoEnd = cues[cues.length - 1].end

  // Start: the cue that contains wantStart, else the nearest following cue start.
  let start = wantStart
  const startCue = cues.find(c => c.start <= wantStart && c.end > wantStart)
  if (startCue) start = startCue.start
  else {
    const next = cues.find(c => c.start >= wantStart)
    start = next ? next.start : wantStart
  }
  start = Math.max(0, start)

  // End: aim for wantEnd, snapped up to the end of the cue it lands in.
  let end = Math.min(wantEnd, videoEnd)
  const endCue = cues.find(c => c.start < end && c.end >= end)
  if (endCue) end = endCue.end

  // Clamp length into [minSec, maxSec] by walking cue ends outward/inward.
  if (end - start > maxSec) {
    const cap = start + maxSec
    // Pull back to the last cue end at or before the cap (whole sentences).
    const trimmed = [...cues].reverse().find(c => c.end <= cap && c.end > start)
    end = trimmed ? trimmed.end : cap
  }
  if (end - start < minSec) {
    const target = Math.min(videoEnd, start + minSec)
    const grown = cues.find(c => c.end >= target)
    end = grown ? grown.end : target
  }

  end = Math.min(end, videoEnd)
  if (end - start < Math.min(minSec, 5)) return null // too short to be a Short
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 }
}

/** Drop clips whose windows overlap an already-accepted one (keeps the higher
 *  scorer, which comes first after the sort). */
function dedupeOverlaps(clips: ClipSuggestion[]): ClipSuggestion[] {
  const kept: ClipSuggestion[] = []
  for (const c of clips) {
    const clash = kept.some(k => c.startSec < k.endSec && c.endSec > k.startSec)
    if (!clash) kept.push(c)
  }
  return kept
}

export async function planShorts(anthropic: Anthropic, opts: PlanOpts): Promise<ClipSuggestion[]> {
  const cues = opts.cues || []
  if (cues.length === 0) return []
  const minSec = Math.max(5, opts.minSec ?? 15)
  const maxSec = Math.min(60, opts.maxSec ?? 30)
  const count = Math.min(10, Math.max(1, opts.count ?? 5))
  const niches = opts.niches || 'general'
  const tone = opts.tone || 'conversational, energetic'
  const videoEnd = cues[cues.length - 1].end
  const excludeRanges = (opts.excludeRanges || []).filter(r => Number.isFinite(r.startSec) && Number.isFinite(r.endSec) && r.endSec > r.startSec)

  // ── Two-pass on long videos ────────────────────────────────────────────────
  // Cheap Haiku hotspot scan → feed Sonnet ONLY the top windows, not the whole
  // transcript. Short videos skip this (no token win, just added latency). The
  // Sonnet clips still carry ABSOLUTE timestamps, so snapWindow + subtitle
  // slicing below run against the FULL cue list unchanged.
  let promptCues = cues
  if (videoEnd > LONG_VIDEO_SEC) {
    const spots = await hotspotScan(anthropic, cues, opts)
    // Drop windows already mined in a previous "Find more" run.
    const fresh = spots.filter(w => !excludeRanges.some(r => overlaps(w.startSec, w.endSec, r.startSec, r.endSec)))
    const pool = fresh.length ? fresh : spots
    // Send enough windows to comfortably yield `count` clips (a ~4-min window
    // holds a few), but never the whole video.
    const need = Math.max(3, Math.ceil(count / 2) + 1)
    const chosen = [...pool].sort((a, b) => b.score - a.score).slice(0, need).sort((a, b) => a.startSec - b.startSec)
    const reduced = cues.filter(c => chosen.some(w => c.start >= w.startSec && c.start < w.endSec))
    if (reduced.length > 0) promptCues = reduced
  }
  const timestamped = cuesToTimestampedText(promptCues)

  const system =
    'You are a short-form video editor who cuts viral 15–30s vertical Shorts out of long YouTube videos. ' +
    'You are given a timestamped transcript. Your ONLY job is to pick the strongest self-contained moments and ' +
    'write a hook + caption for each — you must NOT invent or paraphrase anything the speaker says; the on-screen ' +
    'subtitles are taken verbatim from the transcript later. Return ONLY valid JSON.'

  // The creator's own description names the product + framing — a big help for
  // writing captions/hooks/hashtags that actually sell it. Trimmed so it can't
  // dominate the prompt.
  const desc = (opts.sourceDescription || '').replace(/\s+/g, ' ').trim().slice(0, 1200)

  const user =
    `VIDEO: "${opts.videoTitle}"\n` +
    `NICHE: ${niches}\nTONE: ${tone}\n` +
    (opts.voiceBlock ? `\nWRITE THE HOOKS AND CAPTIONS IN THE CREATOR'S OWN VOICE (this overrides the generic tone above):\n${opts.voiceBlock}\n\n` : '') +
    `VIDEO LENGTH: ${Math.round(videoEnd)}s\n\n` +
    (desc ? `VIDEO DESCRIPTION (for product + context — use it to make hooks, captions and hashtags land the product; do NOT quote it as a subtitle):\n${desc}\n\n` : '') +
    `Timestamps below are [mm:ss]; seconds = minutes*60 + seconds.\n\n` +
    `TRANSCRIPT:\n${timestamped}\n\n` +
    `Pick the ${count} BEST moments to cut as standalone Shorts. A great Short moment is: a strong hook or ` +
    `bold claim, a surprising result/number, a mini-story with a payoff, a before/after, a hot take, or a clear ` +
    `tip — something that makes sense with NO other context. Each clip MUST be ${minSec}–${maxSec} seconds long.\n\n` +
    `Rules:\n` +
    `- startSec/endSec are integer SECONDS on the video timeline; endSec-startSec must be ${minSec}–${maxSec}.\n` +
    `- Clips must NOT overlap. Spread them across the video.\n` +
    `- hook: a punchy on-screen title (≤ 8 words) that fits the moment. No clickbait that the clip doesn't deliver.\n` +
    `- caption: 1–2 sentence post caption in the creator's ${tone} voice. Open with the strongest hook, ` +
    `add 1–2 relevant emoji (never more, never decorative rows of them), and end with a light engagement ` +
    `prompt or soft CTA ("which would you grab?", "save this for later", "link in bio"). Sound like a real ` +
    `creator, not a brand. Never use the word "honest".\n` +
    `- hashtags: 3–5 specific, niche hashtags (no #ad here; the poster adds disclosure).\n` +
    `- score: 0–100, your honest estimate of stop-the-scroll potential.\n\n` +
    `Return ONLY a JSON array:\n` +
    `[{"startSec":90,"endSec":112,"hook":"...","caption":"...","reason":"why this works","score":78,` +
    `"hashtags":["#x","#y","#z"]}]`

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  })
  try {
    recordAnthropicUsage(msg, {
      userId: opts.telemetry?.userId ?? null,
      tier: opts.telemetry?.tier ?? null,
      feature: 'shorts_plan',
      model: MODEL,
    })
  } catch { /* telemetry is best-effort */ }

  const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
  const rawClips = parseJSONArray(text)

  const out: ClipSuggestion[] = []
  for (const rc of rawClips) {
    const ws = Number(rc.startSec)
    const we = Number(rc.endSec)
    if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue
    const win = snapWindow(cues, ws, we, minSec, maxSec)
    if (!win) continue
    // Subtitles are lifted VERBATIM from the transcript — the no-fabrication line.
    // Stored WORD-level (clip-relative) so the caption engine can animate each
    // word; the render groups them into lines (Cloudinary) or karaokes them
    // per-word (FFmpeg + libass).
    const subtitles = sliceCuesToWindow(cues, win.start, win.end)
      .map(c => ({ startSec: c.start, endSec: c.end, text: c.text }))
    if (subtitles.length === 0) continue
    out.push({
      startSec: win.start,
      endSec: win.end,
      hook: (rc.hook || '').toString().slice(0, 90).trim(),
      caption: (rc.caption || '').toString().slice(0, 400).replace(/\bhonest(ly)?\b/gi, '').trim(),
      reason: (rc.reason || '').toString().slice(0, 300).trim(),
      score: Math.max(0, Math.min(100, Math.round(Number(rc.score) || 0))),
      hashtags: Array.isArray(rc.hashtags)
        ? rc.hashtags.map(h => String(h).trim()).filter(Boolean).slice(0, 6)
        : [],
      subtitles,
    })
  }

  out.sort((a, b) => b.score - a.score)
  // "Find more" dedupe: never re-surface a clip that overlaps a window mined in
  // an earlier run (the caller passes those as excludeRanges).
  const notSeen = excludeRanges.length
    ? out.filter(c => !excludeRanges.some(r => overlaps(c.startSec, c.endSec, r.startSec, r.endSec)))
    : out
  return dedupeOverlaps(notSeen).slice(0, count)
}
