// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMAZON LIVE FOLLOW-UP (Labs, admin while it is tested). The pure parts.
//
// After a Live, the creator gives MVP the replay link. SCOUT reads the replay
// page (stream address, products shown), the video service pulls the audio,
// Whisper transcribes it, and Claude finds the moment each product was shown.
// One vertical clip is cut per product. Nothing posts by itself: each clip
// opens in Clip Factory as a draft, and the roundup post is text to copy.

import type { TranscriptCue } from '@/lib/shorts-types'

export type LiveMoment = {
  asin: string
  title: string
  startSec: number
  endSec: number
  hook: string
  clipUrl?: string | null
  clipError?: string | null
}

export type LiveProduct = { asin: string; title: string; plannedMin?: number | null }

/** A clip is 15 to 90 seconds: long enough to show the product, short enough
 *  for Shorts, Reels and TikTok. */
export const CLIP_MIN_SEC = 15
export const CLIP_MAX_SEC = 90

/**
 * The stream to read, from what the replay page loaded. An HLS master playlist
 * first (it carries every quality), then any playlist, then an mp4. Pure.
 */
export function pickStream(streams: readonly string[]): string | null {
  const https = streams.filter((s) => /^https:\/\//i.test(s))
  const m3u8 = https.filter((s) => /\.m3u8(\?|$)/i.test(s))
  return m3u8.find((s) => /master|index|playlist/i.test(s.split('?')[0]))
    ?? m3u8[0]
    ?? https.find((s) => /\.mp4(\?|$)/i.test(s))
    ?? null
}

/** A moment kept inside the replay and inside the clip length limits, or null
 *  when it cannot make a clip. Pure. */
export function clampMoment(m: { startSec: number; endSec: number }, durationSec: number | null): { startSec: number; endSec: number } | null {
  let start = Math.max(0, Math.floor(Number(m.startSec)))
  let end = Math.ceil(Number(m.endSec))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const cap = durationSec && durationSec > 0 ? durationSec : Infinity
  if (start >= cap) return null
  end = Math.min(end, cap, start + CLIP_MAX_SEC)
  if (end - start < CLIP_MIN_SEC) {
    end = Math.min(cap, start + CLIP_MIN_SEC)
    if (end - start < CLIP_MIN_SEC) start = Math.max(0, end - CLIP_MIN_SEC)
  }
  return end - start >= 5 ? { startSec: start, endSec: end } : null
}

/** The transcript words inside a clip, timed from the clip's own start, for
 *  the burned captions. Pure. */
export function wordsInWindow(cues: readonly TranscriptCue[], startSec: number, endSec: number): Array<{ startSec: number; endSec: number; text: string }> {
  return cues
    .filter((c) => c.end > startSec && c.start < endSec)
    .map((c) => ({
      startSec: Math.max(0, Math.round((c.start - startSec) * 100) / 100),
      endSec: Math.max(0.05, Math.round((Math.min(c.end, endSec) - startSec) * 100) / 100),
      text: c.text,
    }))
}

export function buildMatchPrompt(products: readonly LiveProduct[], transcript: string): { system: string; user: string } {
  const list = products.map((p) => `- ${p.asin}: ${p.title}${p.plannedMin != null ? ` (planned around minute ${p.plannedMin})` : ''}`).join('\n')
  return {
    system: 'You find where each product is shown in the transcript of an Amazon Live stream. Return STRICT JSON only: {"moments":[{"asin","startSec","endSec","hook"}]}. '
      + 'Use the [mm:ss] times in the transcript, converted to seconds. Pick the stretch where the host introduces and demonstrates the product, 20 to 75 seconds long, '
      + 'starting a moment before the product is named. hook is one short sentence a viewer would stop scrolling for, in the host\'s own words where possible, '
      + 'with no prices, no discounts and no claims the host did not make. Leave a product out when it is not clearly discussed. No markdown.',
    user: `PRODUCTS:\n${list}\n\nTRANSCRIPT:\n${transcript}\n\nReturn the JSON now.`,
  }
}

/** Claude's answer, kept only for products that were asked about. Pure. */
export function parseMoments(raw: string, products: readonly LiveProduct[], durationSec: number | null): LiveMoment[] {
  let j: { moments?: unknown }
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { return [] }
  const byAsin = new Map(products.map((p) => [p.asin, p]))
  const out: LiveMoment[] = []
  const seen = new Set<string>()
  for (const m of (Array.isArray(j.moments) ? j.moments : []) as Array<Record<string, unknown>>) {
    const asin = String(m?.asin || '').toUpperCase()
    const p = byAsin.get(asin)
    if (!p || seen.has(asin)) continue
    const w = clampMoment({ startSec: Number(m.startSec), endSec: Number(m.endSec) }, durationSec)
    if (!w) continue
    seen.add(asin)
    out.push({ asin, title: p.title, ...w, hook: String(m.hook || '').replace(/\s+/g, ' ').trim().slice(0, 160) })
  }
  return out.sort((a, b) => a.startSec - b.startSec)
}

/** The "everything I showed" post: one line per product with its link, then
 *  the disclosure. Plain text, no AI. Pure. */
export function composeRoundup(input: { title?: string | null; items: Array<{ title: string; link: string | null }>; disclosure: string }): string {
  const lines = input.items.filter((i) => i.link).map((i) => `• ${shortTitle(i.title)}: ${i.link}`)
  const head = input.title ? `Thanks for watching my Amazon Live, "${input.title}". Everything I showed:` : 'Thanks for watching my Amazon Live. Everything I showed:'
  return [head, '', ...lines, '', input.disclosure].join('\n').trim()
}

export function shortTitle(t: string): string {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  const cut = s.split(/[,|(]/)[0].trim()
  return (cut.length >= 12 ? cut : s).slice(0, 70)
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
