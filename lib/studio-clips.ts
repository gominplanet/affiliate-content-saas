// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CLIP FIRST (Seb, 2026-11-27: "start the faster clip first method. So we can
// render faster"). A Video Builder set's hooks, bodies and CTAs are each read
// and edited once, as a clip (a review_edits row, studio_role 'clip', named
// by its label: H1, B2, C3), and every video of the set (studio_role 'combo')
// is its clips joined one after another on the video server
// (ingest-service /assemble-edit), not made again from the start. Three
// hooks, three bodies and three CTAs are nine edits and twenty-seven joins,
// where they were twenty-seven edits.
//
// A clip made again (its cuts changed in the Review Editor) puts its videos
// together again, except one already sent to the brand.
//
// Pure, so it is tested (scripts/test-edit-studio.ts).

import { brollFor, type MixCombo } from './studio-mix'
import type { EditSettings } from './review-edit'

export type ClipPart = 'hook' | 'body' | 'cta'
export const PART_LETTER: Record<ClipPart, string> = { hook: 'H', body: 'B', cta: 'C' }

/** A clip a set needs: its part, its place in its column, and its label. */
export interface NeededClip { part: ClipPart; i: number; label: string }

/** The clips the chosen videos use, each once, hooks then bodies then CTAs.
 *  A clip no video uses is not edited. Pure. */
export function neededClips(combos: Pick<MixCombo, 'h' | 'b' | 'c'>[]): NeededClip[] {
  const seen = new Set<string>()
  const out: NeededClip[] = []
  const add = (part: ClipPart, i: number | null | undefined) => {
    if (i == null || i < 0) return
    const label = `${PART_LETTER[part]}${i + 1}`
    if (seen.has(label)) return
    seen.add(label)
    out.push({ part, i, label })
  }
  for (const part of ['hook', 'body', 'cta'] as ClipPart[]) for (const cb of combos) add(part, part === 'hook' ? cb.h : part === 'body' ? cb.b : cb.c)
  const order = { hook: 0, body: 1, cta: 2 }
  return out.sort((a, b) => order[a.part] - order[b.part] || a.i - b.i)
}

/** The labels of one video's clips, in order. Pure. */
export function comboLabels(cb: Pick<MixCombo, 'h' | 'b' | 'c'>): string[] {
  return [`H${cb.h + 1}`, `B${cb.b + 1}`, ...(cb.c != null ? [`C${cb.c + 1}`] : [])]
}

/** Which B-roll clips go with a clip (indices into the set's B-roll), the
 *  set's clips taking turns so each part opens on a different one. A hook
 *  in a talking video has none: the opening is the creator's face. A
 *  voiceover clip always has them: they are its picture. Pure. */
export function clipBroll(k: number, part: ClipPart, brollCount: number, voiceover: boolean): number[] {
  if (!brollCount) return []
  if (!voiceover && part === 'hook') return []
  // Started at a different clip each time, so each part opens on its own shot.
  const list = brollFor(k, brollCount)
  const r = k % list.length
  return [...list.slice(r), ...list.slice(0, r)]
}

/** The options a clip is made with. The title is on the hook, where the
 *  video starts; a title on for the whole video is on every clip. Pure. */
export function clipSettings(s: EditSettings, part: ClipPart): EditSettings {
  if (part === 'hook' || (s.title.on && s.title.seconds === 0)) return s
  return { ...s, title: { ...s.title, on: false } }
}

/** One clip as a video waiting for it sees it. */
export interface ClipState { label: string; status: string; note: string | null; hasOutput: boolean }

/** Where a video waiting for its clips stands: ready to be put together,
 *  still waiting (and on what), or stopped by a clip that failed. Pure. */
export function comboState(parts: (ClipState | null)[]): { state: 'ready' } | { state: 'waiting'; note: string } | { state: 'failed'; note: string } {
  const missing = parts.findIndex((p) => !p)
  if (missing >= 0) return { state: 'failed', note: `Clip ${missing + 1} of this video was removed, so it cannot be put together. Add its clips again.` }
  const ps = parts as ClipState[]
  const bad = ps.find((p) => p.status === 'failed')
  if (bad) return { state: 'failed', note: `${bad.label} could not be edited${bad.note ? `: ${bad.note.replace(/\.$/, '')}` : ''}. Press Try again on ${bad.label} below, and this video is put together once it is edited.` }
  if (ps.every((p) => p.status === 'done' && p.hasOutput)) return { state: 'ready' }
  const word = (p: ClipState) => (p.status === 'done' ? 'edited' : p.status === 'making' ? 'being made' : p.status === 'ready_to_make' ? 'waiting its turn' : p.status === 'reading' ? 'being read' : 'in line')
  return { state: 'waiting', note: `Waiting for its clips: ${ps.map((p) => `${p.label} ${word(p)}`).join(', ')}.` }
}

/** A video already put together is put together again when one of its clips
 *  is made again, unless it was sent to the brand (or is being sent). Pure. */
export function remakeOnClip(combo: { status: string; made_at: string | null; studio_send?: { state?: string } | null }, clipMadeAt: string | null): boolean {
  if (combo.status !== 'done' || !clipMadeAt) return false
  const s = combo.studio_send?.state
  if (s === 'in_review' || s === 'sent_unconfirmed' || s === 'sending') return false
  return !combo.made_at || Date.parse(clipMadeAt) > Date.parse(combo.made_at)
}

/** One video's words on its own timeline: each clip's words (already on the
 *  clip's finished timeline) moved by the length of the clips before it, for
 *  the brand rules check of the whole video. Pure. */
export function joinWords<W extends { start: number; end: number }>(clips: { words: W[]; seconds: number }[]): { words: W[]; seconds: number } {
  const words: W[] = []
  let at = 0
  for (const c of clips) {
    for (const w of c.words) words.push({ ...w, start: Math.round((w.start + at) * 1000) / 1000, end: Math.round((w.end + at) * 1000) / 1000 })
    at += Number(c.seconds) || 0
  }
  return { words, seconds: Math.round(at * 1000) / 1000 }
}

/** The SQL the clip-first Video Builder and the shared music library need
 *  (migration 478), said where it is missing. Safe to run twice. */
export const CLIP_SQL = 'The faster Video Builder needs migration 478 (clip first, and the shared music library). Run it in the Supabase SQL editor, then press Process again.'
