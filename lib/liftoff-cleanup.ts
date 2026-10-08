// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIFTOFF VIDEO FILES ARE NOT KEPT FOR EVER (Seb, 2026-10-08: "delete any
// batch video that's been there for ... a couple of days. If they haven't
// been uploaded or if they're done uploading to YouTube and Amazon and
// everything is done, it should be deleted from the server").
//
// A video in a batch is up to two files of up to 800 MB each: the creator's
// original, and the copy with the CTA burned in that YouTube gets. The rules,
// decided here and run hourly by app/api/cron/liftoff-cleanup:
//
//   never launched, nothing touched for 2 days    both files go
//   could not go to YouTube, untouched 2 days     both files go
//   on YouTube, untouched 2 days                  the CTA copy goes
//   on YouTube and Amazon done, 30 days quiet     the original goes too
//   launched but still waiting, 14 days quiet     both files go
//   anything at all, 60 days quiet                both files go
//
// The original stays 30 days (Seb chose it) because Clip Factory cuts Shorts
// from it and Global Sync sends it to other countries; YouTube will not hand
// a creator's own video back. A row whose files are gone says so on the
// board, in its own words, so a missing file never looks like a broken one.

export const DAY_MS = 86_400_000
export const IDLE_DAYS = 2
export const ORIGINAL_DAYS = 30
export const WAITING_DAYS = 14
/** Past this nothing is still coming for the file: an Amazon country stuck
 *  for two months does not keep an 800 MB file for ever. */
export const BACKSTOP_DAYS = 60

/** On a row whose files were removed before it reached YouTube. The board
 *  reads this start to leave Try again off: there is nothing to try. */
export const FILES_REMOVED = 'The video file was removed after'

export type CleanupItem = {
  state: string
  youtube_video_id: string | null
  /** The newest time anything happened to the video. */
  lastAt: number
  batchLaunched: boolean
  /** Every Amazon country it was meant for has finished (uploaded, live, or
   *  stopped with a reason), or no Amazon was asked for. */
  amazonDone: boolean
  hasCta: boolean
  hasOriginal: boolean
}

export type CleanupAct = { cta: boolean; original: boolean; reason: string | null }

/** What to remove from one video now. Pure. */
export function cleanupFor(i: CleanupItem, now: number): CleanupAct {
  const idle = now - i.lastAt
  const none: CleanupAct = { cta: false, original: false, reason: null }
  if (!i.hasCta && !i.hasOriginal) return none
  const both = (days: number, why: string): CleanupAct => ({
    cta: i.hasCta, original: i.hasOriginal,
    reason: `${FILES_REMOVED} ${days} days ${why}, to keep storage free. Remove this video and add it again to send it.`,
  })
  if (idle >= BACKSTOP_DAYS * DAY_MS) return { cta: i.hasCta, original: i.hasOriginal, reason: !i.youtube_video_id && i.state !== 'amazon_only' ? `${FILES_REMOVED} ${BACKSTOP_DAYS} days with nothing happening, to keep storage free. Remove this video and add it again to send it.` : null }
  if (!i.batchLaunched) return idle >= IDLE_DAYS * DAY_MS ? both(IDLE_DAYS, 'without a launch') : none
  if (i.state === 'amazon_only') {
    // No YouTube copy to make: the original is the whole job until Amazon is done.
    return i.amazonDone && idle >= ORIGINAL_DAYS * DAY_MS ? { cta: i.hasCta, original: i.hasOriginal, reason: null } : none
  }
  // ON YOUTUBE IS A VIDEO ID, whatever the row's state: a video Studio has
  // and MVP is still timing (or holding private) no longer needs its files.
  const onYouTube = !!i.youtube_video_id
  if (!onYouTube && i.state === 'blocked') return idle >= IDLE_DAYS * DAY_MS ? both(IDLE_DAYS, 'it could not go to YouTube') : none
  if (!onYouTube) return idle >= WAITING_DAYS * DAY_MS ? both(WAITING_DAYS, 'waiting to upload') : none
  return {
    cta: i.hasCta && idle >= IDLE_DAYS * DAY_MS,
    original: i.hasOriginal && i.amazonDone && idle >= ORIGINAL_DAYS * DAY_MS,
    reason: null,
  }
}

/** Amazon countries that have finished, as the coverage grid records them. */
export const COVERAGE_FINISHED = new Set(['uploaded', 'live', 'blocked'])
