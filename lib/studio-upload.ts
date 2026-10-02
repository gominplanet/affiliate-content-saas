// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIFTOFF UPLOADS THROUGH SCOUT IN YOUTUBE STUDIO.
//
// An upload through YouTube's Data API costs 1,600 of the 10,000 units a day
// that every MVP account shares, so the API could take about six videos a day
// for everybody together. Raising the quota means a Google review that takes
// weeks. A video uploaded in YouTube Studio costs nothing from it, so for a
// creator with this switch on, Liftoff hands the upload to SCOUT: SCOUT opens
// Studio's upload box in their own signed-in Chrome, puts the finished file in
// it, fills the title, description, Not made for kids, paid promotion and AI
// use, and saves it private. Once MVP has the new video's id, the server goes
// on exactly as for an API upload (read back, schedule or go public,
// thumbnail, playlist, pinned comment, Amazon), which costs about 200 units
// instead of 1,800.
//
// The server never uploads a row this switch covers: it waits, saying so on
// the row, until SCOUT reports back (app/api/launch/studio-uploads).

import { canUsePreview } from '@/lib/labs-preview'

/** Does this creator's Liftoff upload through SCOUT in Studio. */
export function usesStudioUpload(tier: unknown): boolean {
  return canUsePreview('studio_upload', tier)
}

/** On a row waiting for SCOUT. Starts with "Waiting" so the board reads it as waiting. */
export const STUDIO_UPLOAD_WAITING =
  'Waiting for SCOUT to upload it through YouTube Studio. Keep Chrome open with SCOUT and MVP signed in; it carries on by itself.'

/** On a row SCOUT has claimed and is uploading. */
export const STUDIO_UPLOAD_RUNNING = 'SCOUT is uploading it through YouTube Studio now.'

/** On a row SCOUT uploaded, until the server sets its time. */
export const STUDIO_UPLOAD_DONE = 'Uploaded through YouTube Studio by SCOUT. MVP sets its time next.'

/** How long a claimed upload is left alone before it is offered again: the
 *  file can take a long time to send, and SCOUT gives up at 70 minutes. */
export const STUDIO_UPLOAD_CLAIM_MS = 75 * 60_000

/** Upload attempts before the row stops and says why. */
export const STUDIO_UPLOAD_TRIES = 3

export function isStudioWaiting(reason: string | null | undefined): boolean {
  return String(reason || '').startsWith(STUDIO_UPLOAD_WAITING.slice(0, 40))
}

export function isStudioRunning(reason: string | null | undefined): boolean {
  return String(reason || '').startsWith(STUDIO_UPLOAD_RUNNING)
}

/** A YouTube video id, or null. */
export function cleanVideoId(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null
}

/** SCOUT's own failure words, put to the creator. Pure. */
export function studioUploadFailureText(error: string | null | undefined, detail: string | null | undefined): string {
  const e = String(error || '').trim()
  const d = String(detail || '').trim()
  if (e === 'wrong-channel') return d || 'Studio was on a different channel from this batch, so nothing was uploaded.'
  if (e === 'upload-limit') return 'Waiting: YouTube says this channel has reached its own daily upload limit. SCOUT tries again later.'
  if (e === 'not-installed') return 'SCOUT is not installed in this Chrome, so it could not upload.'
  if (e === 'busy') return 'SCOUT was busy with another Studio job.'
  if (e === 'timeout') return 'SCOUT did not report back within 70 minutes. Check the video in YouTube Studio before pressing Try again.'
  if (e === 'not-sent') return `Studio did not finish receiving the file${d ? ` (${d})` : ''}, so nothing was kept.`
  if (e === 'no-picker') return 'YouTube Studio did not open its upload box. Check that this Chrome is signed in to the right YouTube channel.'
  if (/^file-/.test(e) || e === 'empty-file') return `SCOUT could not read MVP's copy of the video${d ? ` (${d})` : ''}.`
  if (e === 'no-video-id') return d || 'The file went into Studio, but Studio did not show the new video’s link.'
  return d ? `SCOUT could not upload it: ${d}` : `SCOUT could not upload it${e ? ` (${e})` : ''}.`
}

/** What SCOUT set and read back on a Studio upload (migration 399). */
export type StudioDid = {
  text: boolean | null; tags: boolean | null; thumbnail: boolean | null; playlist: boolean | null
  /** SCOUT 1.27.0+ saw its own image in Studio's thumbnail box. Without it a
   *  thumbnail "set" by SCOUT is not believed, and MVP sets it itself. */
  thumbVerified: boolean
  /** The visibility SCOUT saved: 'schedule', 'public', 'private', or null when it did not save. */
  visibility: 'schedule' | 'public' | 'private' | null
  publishAt: string | null
}

/** SCOUT's report, cleaned: anything not plainly true is "not done". Pure. */
export function studioDid(raw: unknown, saved: boolean): StudioDid {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const b = (k: string) => (o[k] === true ? true : o[k] === false ? false : null)
  const v = saved && (o.visibility === 'schedule' || o.visibility === 'public' || o.visibility === 'private') ? o.visibility : null
  const at = v === 'schedule' && typeof o.publishAt === 'string' && !isNaN(Date.parse(o.publishAt)) ? new Date(o.publishAt).toISOString() : null
  return { text: b('text'), tags: b('tags'), thumbnail: b('thumbnail'), thumbVerified: o.thumbVerified === true, playlist: b('playlist'), visibility: v === 'schedule' && !at ? null : v, publishAt: at }
}

/** Read back from YouTube, did SCOUT's schedule hold: private, with the time
 *  asked for (within two minutes). Pure. */
export function scheduleHeld(did: StudioDid | null, read: { privacyStatus: string | null; publishAt: string | null } | null, planned: string): boolean {
  if (!did || did.visibility !== 'schedule' || !read || read.privacyStatus !== 'private' || !read.publishAt) return false
  return Math.abs(Date.parse(read.publishAt) - Date.parse(planned)) <= 120_000
}

/** How long after its time a first comment is left for SCOUT before the cron
 *  posts it through the API (50 units) instead: late at worst, never lost. */
export const SCOUT_COMMENT_GRACE_MS = 3 * 3_600_000

/** Should the cron leave this comment to SCOUT for now. Pure. */
export function leaveCommentToScout(scoutUser: boolean, publishAt: string | null, now = Date.now()): boolean {
  if (!scoutUser || !publishAt) return false
  const t = Date.parse(publishAt)
  return !isNaN(t) && now - t < SCOUT_COMMENT_GRACE_MS
}

const STEP_WORDS: Record<string, string> = {
  upload: 'the upload', text: 'the title and description', tags: 'the tags', thumbnail: 'the thumbnail',
  playlist: 'the playlist', sending: 'sending the file', open: 'opening the upload', details: 'paid promotion and AI use',
  next: 'moving to the next page', monetization: 'monetization', adsuit: 'the ad rating', elements: 'video elements',
  endscreen: 'the end screen', checks: 'the checks page', visibility: 'saving it (Visibility)', unknown: 'a page SCOUT did not recognise',
}

/** The step a SCOUT Studio run stopped at, in words, with what Studio showed.
 *  Null when nothing failed. Pure. */
export function studioStoppedAt(steps: Array<{ step: string; ok: boolean; skipped?: boolean; detail?: string }>): string | null {
  const bad = steps.filter((x) => !x.ok && !x.skipped)
  if (bad.length === 0) return null
  const first = bad[0]
  const words = STEP_WORDS[first.step] ?? first.step
  const others = bad.slice(1).map((x) => STEP_WORDS[x.step] ?? x.step).filter((w, i, a) => a.indexOf(w) === i && w !== words)
  return `It stopped at ${words}${first.detail ? `: ${first.detail.replace(/\.$/, '')}` : ''}.${others.length ? ` Also not done: ${others.join(', ')}.` : ''}`
}
