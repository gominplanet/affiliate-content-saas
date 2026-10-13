// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW A VIDEO IS SPLIT FOR TIKTOK (Seb, 2026-10-13: "TikTok upload-init
// failed (invalid_params): The chunk size is invalid" on a 3:41 clip).
// MVP always sent a video as one chunk, which TikTok takes only up to 64 MB.
// TikTok's media transfer rules:
//   - a video under 5 MB goes whole, as one chunk;
//   - a video up to 64 MB may go whole;
//   - otherwise every chunk is 5 MB to 64 MB, the count is
//     floor(video_size / chunk_size), and the last chunk carries the rest
//     (up to 128 MB); at most 1000 chunks.
// Pure, so it is tested (scripts/test-tiktok-chunks).

export const MB = 1024 * 1024
export const SINGLE_MAX = 64 * MB
export const CHUNK = 32 * MB

export interface ChunkPlan {
  chunkSize: number
  count: number
  /** Byte ranges, inclusive, in upload order. */
  ranges: Array<{ start: number; end: number }>
}

export function planChunks(videoSize: number): ChunkPlan {
  if (!Number.isFinite(videoSize) || videoSize <= 0) throw new Error('No video bytes to upload.')
  if (videoSize <= SINGLE_MAX) return { chunkSize: videoSize, count: 1, ranges: [{ start: 0, end: videoSize - 1 }] }
  const count = Math.floor(videoSize / CHUNK)
  const ranges = Array.from({ length: count }, (_, i) => ({
    start: i * CHUNK,
    // The last chunk takes everything left (32 MB to under 64 MB).
    end: i === count - 1 ? videoSize - 1 : (i + 1) * CHUNK - 1,
  }))
  return { chunkSize: CHUNK, count, ranges }
}
