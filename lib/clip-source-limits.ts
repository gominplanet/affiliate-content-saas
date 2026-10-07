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
