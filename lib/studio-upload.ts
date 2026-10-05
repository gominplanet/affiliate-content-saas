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
  // NOT SAVED, NOT KEPT. Studio throws away what was typed into an upload
  // window that was never saved (tags and thumbnail went with a window whose
  // Next stayed grey), so nothing SCOUT read back there counts: MVP sets it.
  if (!saved) return { text: null, tags: null, thumbnail: null, thumbVerified: false, playlist: null, visibility: null, publishAt: null }
  return { text: b('text'), tags: b('tags'), thumbnail: b('thumbnail'), thumbVerified: o.thumbVerified === true, playlist: b('playlist'), visibility: v === 'schedule' && !at ? null : v, publishAt: at }
}

/** Did SCOUT see Paid promotion ticked in Studio, read back from Studio's own
 *  saved state (a step's readBack.paidPromotion, the last one that answered).
 *  Used when YouTube's API cannot be asked (its daily quota is used up), so a
 *  video SCOUT disclosed is not held private on a read that never happened.
 *  An API read that answers still decides. Pure. */
export function scoutSawPaidPromotion(raw: unknown): boolean {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { steps?: unknown }
  const steps = Array.isArray(o.steps) ? o.steps as Array<{ readBack?: Record<string, unknown> }> : []
  let seen: boolean | null = null
  for (const st of steps) {
    const v = st?.readBack?.paidPromotion
    if (v === true || v === false) seen = v
  }
  return seen === true
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

/** How long an older video's comment (no publish time: the video is already
 *  public) is left for SCOUT before the cron may post it through the API. */
export const SCOUT_BACKLOG_GRACE_MS = 24 * 3_600_000

/** Should the cron leave this comment to SCOUT for now. Pure. */
export function leaveCommentToScout(scoutUser: boolean, publishAt: string | null, now = Date.now(), createdAt?: string | null): boolean {
  if (!scoutUser) return false
  if (!publishAt) {
    // An older video: SCOUT gets a day to post it for free first.
    const c = Date.parse(String(createdAt || ''))
    return !isNaN(c) && now - c < SCOUT_BACKLOG_GRACE_MS
  }
  const t = Date.parse(publishAt)
  return !isNaN(t) && now - t < SCOUT_COMMENT_GRACE_MS
}

/** Older-video comments the cron may post through YouTube's API per account
 *  per Pacific day (50 units each, so 1,000 at most). The rest wait for SCOUT
 *  or the next day. One back catalogue of 151 used 7,550 units on 2026-10-05,
 *  three quarters of the day every account shares. */
export const API_BACKLOG_COMMENTS_PER_DAY = 20

/** May the cron post this one through the API right now. Pure. A comment with
 *  a publish time (a new upload) always may; an older video's only while the
 *  account is under its daily share and the day is under the reserve line, so
 *  uploads, thumbnails and new comments keep the rest. */
export function apiCommentAllowed(publishAt: string | null, postedTodayByAccount: number, dayOverReserve: boolean): boolean {
  if (publishAt) return true
  return !dayOverReserve && postedTodayByAccount < API_BACKLOG_COMMENTS_PER_DAY
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

/** How a SCOUT upload that ended as a Studio draft starts its row's note. */
export const DRAFT_REASON_PREFIX = 'On your channel ('
/** On a draft SCOUT is saving in Studio right now. */
export const STUDIO_DRAFT_SAVING = 'SCOUT is saving the draft in Studio now.'
/** On a draft SCOUT tried and could not save: left for the creator. */
export const STUDIO_DRAFT_FAILED = 'SCOUT could not save the draft in Studio.'
