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
import { captionsForClip } from '@/lib/shorts-captions'

const MODEL = 'claude-sonnet-4-6'

export interface PlanOpts {
  cues: TranscriptCue[]
  videoTitle: string
  niches?: string
  tone?: string
  /** How many clips to try to surface (clamped 1–10). */
  count?: number
  /** Clip length bounds in seconds. Defaults 15–30 (YouTube Shorts sweet spot). */
  minSec?: number
  maxSec?: number
  telemetry?: { userId: string | null; tier: string | null }
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
  const timestamped = cuesToTimestampedText(cues)

  const system =
    'You are a short-form video editor who cuts viral 15–30s vertical Shorts out of long YouTube videos. ' +
    'You are given a timestamped transcript. Your ONLY job is to pick the strongest self-contained moments and ' +
    'write a hook + caption for each — you must NOT invent or paraphrase anything the speaker says; the on-screen ' +
    'subtitles are taken verbatim from the transcript later. Return ONLY valid JSON.'

  const user =
    `VIDEO: "${opts.videoTitle}"\n` +
    `NICHE: ${niches}\nTONE: ${tone}\n` +
    `VIDEO LENGTH: ${Math.round(videoEnd)}s\n\n` +
    `Timestamps below are [mm:ss]; seconds = minutes*60 + seconds.\n\n` +
    `TRANSCRIPT:\n${timestamped}\n\n` +
    `Pick the ${count} BEST moments to cut as standalone Shorts. A great Short moment is: a strong hook or ` +
    `bold claim, a surprising result/number, a mini-story with a payoff, a before/after, a hot take, or a clear ` +
    `tip — something that makes sense with NO other context. Each clip MUST be ${minSec}–${maxSec} seconds long.\n\n` +
    `Rules:\n` +
    `- startSec/endSec are integer SECONDS on the video timeline; endSec-startSec must be ${minSec}–${maxSec}.\n` +
    `- Clips must NOT overlap. Spread them across the video.\n` +
    `- hook: a punchy on-screen title (≤ 8 words) that fits the moment. No clickbait that the clip doesn't deliver.\n` +
    `- caption: 1–2 sentence post caption in the creator's ${tone} voice. Never use the word "honest".\n` +
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
    const subtitles = captionsForClip(cues, win.start, win.end)
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
  return dedupeOverlaps(out).slice(0, count)
}
