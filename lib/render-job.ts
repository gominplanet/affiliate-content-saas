// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BACKGROUND RENDERS (Seb, 2026-10-10: a 3:55 whole video timed out). A clip
// longer than BACKGROUND_RENDER_SEC is rendered by the ingest service in its
// own time; it posts the outcome to /api/youtube/shorts/render-callback with
// the job token made here. The token is signed, so only a render MVP started
// can mark a clip rendered, and it carries the cap reservation so a failed
// render gives the slot back.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Clips longer than this render in the background. A request MVP waits on
 *  must finish inside five minutes, which a long 1080x1920 render does not. */
export const BACKGROUND_RENDER_SEC = 60
/** A background render with no answer after this long is said to have failed. */
export const BACKGROUND_RENDER_STALE_MS = 25 * 60_000

export type RenderJob = { shortId: string; userId: string; reservationId: string | null }

function secret(): string { return process.env.YOUTUBE_INGEST_SECRET || '' }
function sign(body: string): string { return createHmac('sha256', secret()).update(body).digest('hex').slice(0, 32) }

/** Null when there is no secret to sign with (then renders stay in the request). */
export function makeRenderJob(j: RenderJob): string | null {
  if (!secret()) return null
  const body = `${j.shortId}.${j.userId}.${j.reservationId || '-'}`
  return `${body}.${sign(body)}`
}

export function readRenderJob(token: string | null | undefined): RenderJob | null {
  const t = String(token || '')
  const i = t.lastIndexOf('.')
  if (i < 0 || !secret()) return null
  const body = t.slice(0, i)
  const sig = t.slice(i + 1)
  const want = sign(body)
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  const [shortId, userId, res] = body.split('.')
  if (!shortId || !userId) return null
  return { shortId, userId, reservationId: res && res !== '-' ? res : null }
}

/** The words a failed background render shows on its clip. */
export function backgroundFailureWords(error: string | null | undefined): string {
  const e = String(error || '')
  if (/SIGKILL|timed? ?out|timeout/i.test(e)) return 'The render ran over 15 minutes and was stopped. Try Standard instead of Split screen, or a shorter clip, then render again. Nothing was used from your monthly renders.'
  if (/youtube|yt-dlp|sign in|bot/i.test(e)) return 'YouTube would not let MVP download this video for the render. Upload the video file once (the upload box on this page), then render again. Nothing was used from your monthly renders.'
  return `The render failed (${e.slice(0, 160) || 'no reason given'}). Nothing was used from your monthly renders. Render again.`
}
