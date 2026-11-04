// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How big a Clip Factory SOURCE video may be (the long video clips are cut
// from). Its real limit is its length, 10 minutes (transcription cost goes by
// minutes), not its size: a 2 minute video shot in 4K was 334 MB and was
// refused at 300 MB on 2026-10-06, while a 10 minute 1080p one passed. The
// size cap only keeps an upload from running for ever.
//
// Finished clips (Instagram, TikTok) keep their own platform caps.

export const SOURCE_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** How big a video uploaded to MVP may be: Bulk Amazon upload, Drop, TRYBE
 *  upload and the Review Editor's takes. 2 GB since 2026-11-04 (it was 800 MB):
 *  a DJI Osmo Pocket 3 records about 300 MB a minute even at 1080p (Seb's
 *  4:48 review was 1.42 GB), so 800 MB was under three minutes. 2 GB is about
 *  six and a half minutes of it, and the same limit as Clip Factory's sources
 *  and the YouTube push (launch-drain), so MVP has one number. Everything
 *  after the upload copes: YouTube gets it in 32 MB pieces across runs, the
 *  CTA render streams it, the video server downloads it (15 minutes allowed),
 *  and the storage bucket takes 2 GB (migration 463). */
export const BULK_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** A video over the limit, in words: its size and the limit. Pure. */
export function tooBigWords(bytes: number, max = BULK_VIDEO_MAX_BYTES): string {
  return `${sizeWords(bytes)} is over the ${sizeWords(max)} limit.`
}

export function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`
}

/** Storage refusing a file for its size, in words, or null when that is not
 *  what the error says. */
export function storageSizeRefusal(message: string | null | undefined, bytes: number): string | null {
  const m = String(message || '')
  if (!/maximum allowed size|too large|payload too large|413|exceeds/i.test(m)) return null
  return `MVP's storage would not take a ${sizeWords(bytes)} file (its own size limit). Tell support, or upload a smaller export of the same video.`
}
