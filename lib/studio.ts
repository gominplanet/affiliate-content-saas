// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE EDIT STUDIO'S VIDEOS, IN WORDS (components/labs/TrybeStudio): where each
// one stands, from being read to sent, and when Send is allowed. A video sent
// says so after a reload (review_edits.studio_send), and one whose send was
// not confirmed by TRYBE says that, never "sent" (CLAUDE.md: report what
// happened, not what was intended).
//
// Pure, so it is tested (scripts/test-edit-studio.ts).

import type { CutCheck } from './trybe-edit'
import type { MusicPlaced } from './studio-render'

export type StudioTone = 'ok' | 'warn' | 'bad' | 'wait'
export interface StudioSend { state: 'in_review' | 'sent_unconfirmed' | 'failed' | 'sending'; at?: string | null; itemId?: string | null; note?: string | null }
export interface StudioEdit {
  id: string
  name: string | null
  status: string
  note: string | null
  outputs: Record<string, { url: string; seconds: number }> | null
  studio: {
    brandId: string; check: CutCheck | null; send: StudioSend | null; voiceover?: boolean
    /** Clip first (lib/studio-clips): a clip and its label (H1), or a video and its clips. */
    role?: 'clip' | 'combo' | null; part?: string | null; parts?: string[] | null
  } | null
  /** What went on it, as the video server reported (lib/studio-render). */
  placed?: { music?: MusicPlaced | null } | null
}

/** The finished file, or null. Pure. */
export const outputOf = (e: Pick<StudioEdit, 'outputs'>) => (e.outputs ? Object.values(e.outputs)[0] ?? null : null)

/** Where a studio video stands, in words, and its colour. Pure. */
export function studioStage(e: StudioEdit, brandName = 'the brand'): { word: string; tone: StudioTone } {
  if (e.status === 'failed') return { word: 'Not edited', tone: 'bad' }
  if (e.status === 'waiting') return { word: 'Waiting for its clips', tone: 'wait' }
  const combo = e.studio?.role === 'combo'
  if (e.status !== 'done') return { word: e.status === 'making' ? (combo ? 'Being put together' : 'Being made') : e.status === 'ready_to_make' ? (combo ? 'In line to be put together' : 'Waiting its turn') : 'Being read', tone: 'wait' }
  const send = e.studio?.send
  if (send?.state === 'in_review') return { word: `Sent: ${brandName} is reviewing it`, tone: 'ok' }
  if (send?.state === 'sent_unconfirmed') return { word: 'Sent, not confirmed by TRYBE yet', tone: 'warn' }
  if (send?.state === 'sending') return { word: 'Sending', tone: 'wait' }
  const c = e.studio?.check
  const notSent = send?.state === 'failed' ? 'Not sent. ' : ''
  if (!c) return { word: `${notSent}Edited, not checked against the brand's rules`, tone: 'warn' }
  return c.state === 'red' ? { word: `${notSent}Breaks a rule`, tone: 'bad' } : c.state === 'amber' ? { word: `${notSent}Worth a look`, tone: 'warn' } : { word: `${notSent}Ready to send`, tone: 'ok' }
}

/** A clip's state in a word, for the clips strip. Pure. */
export function clipWord(status: string): { word: string; tone: StudioTone } {
  if (status === 'done') return { word: 'edited', tone: 'ok' }
  if (status === 'failed') return { word: 'not edited', tone: 'bad' }
  return { word: status === 'making' ? 'being made' : status === 'ready_to_make' ? 'waiting its turn' : status === 'reading' ? 'being read' : 'in line', tone: 'wait' }
}

/** Clips in the order of their columns: hooks, bodies, CTAs, then number. Pure. */
export function byLabel<T extends { studio?: { part?: string | null } | null }>(list: T[]): T[] {
  const key = (e: T) => { const l = e.studio?.part || ''; return `${'HBC'.indexOf(l[0] || 'Z')}${String(Number(l.slice(1)) || 0).padStart(3, '0')}` }
  return [...list].sort((a, b) => key(a).localeCompare(key(b)))
}

/** Send is offered for a finished video not already sent or being sent. A
 *  send TRYBE did not confirm is not offered again: check TRYBE first. Pure. */
export function canSendNow(e: StudioEdit): boolean {
  if (e.status !== 'done' || !outputOf(e)) return false
  const s = e.studio?.send?.state
  return !s || s === 'failed'
}

/** A video that breaks a brand rule is sent only after the creator says so. Pure. */
export const needsConfirm = (e: StudioEdit) => e.studio?.check?.state === 'red'

const slug = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/** The file's name when it goes to TRYBE or is downloaded: brand, then the video. Pure. */
export function studioFileName(brandName: string, videoName: string | null, n: number): string {
  const b = slug(brandName) || 'brand'
  const v = slug(videoName || '') || `video-${n}`
  return `${b}-${v}.mp4`
}

/** The month's TRYBE ad edits, in words. Pure. */
export function allowanceWords(a: { used: number; limit: number | null; left: number | null; resetLabel?: string } | null): string | null {
  if (!a) return null
  if (a.limit === null) return `${a.used} TRYBE ads edited this month`
  if (a.left === 0) return `All ${a.limit} TRYBE ad edits used${a.resetLabel ? `, more on ${a.resetLabel}` : ''}`
  return `${a.used} of ${a.limit} TRYBE ad edits used this month`
}
