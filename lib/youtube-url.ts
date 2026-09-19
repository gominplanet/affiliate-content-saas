// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Extract the 11-char video id from any YouTube URL shape (or a bare id).
 * Handles watch?v=, youtu.be/, /shorts/, /embed/, /live/, and extra query
 * params. Returns null when nothing valid is found. Pure — unit-tested.
 */
const ID = /^[A-Za-z0-9_-]{11}$/

export function extractYouTubeVideoId(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw) return null
  // Bare id.
  if (ID.test(raw)) return raw

  // Any of the path/param shapes. Try the most specific patterns first.
  //
  // EVERY PATTERN ENDS ON A BOUNDARY. A YouTube id is exactly 11 characters, so
  // a longer run of id-characters is not an id with something after it, it is a
  // different string entirely. Without the boundary these patterns happily
  // return the first 11 characters of any slug: /shorts/notelevenchars came
  // back as "notelevench", a real-looking id for a video that does not exist.
  //
  // That was harmless while the paths were YouTube-specific. /video/ is not:
  // plenty of sites use it, so a pasted link to anything else would have
  // produced a confident wrong answer instead of "that is not a YouTube link".
  const B = '(?![A-Za-z0-9_-])'
  const patterns = [
    new RegExp(`[?&]v=([A-Za-z0-9_-]{11})${B}`),        // watch?v=ID
    new RegExp(`youtu\\.be\\/([A-Za-z0-9_-]{11})${B}`), // youtu.be/ID
    new RegExp(`\\/shorts\\/([A-Za-z0-9_-]{11})${B}`),  // /shorts/ID
    new RegExp(`\\/embed\\/([A-Za-z0-9_-]{11})${B}`),   // /embed/ID
    new RegExp(`\\/live\\/([A-Za-z0-9_-]{11})${B}`),    // /live/ID
    new RegExp(`\\/v\\/([A-Za-z0-9_-]{11})${B}`),       // /v/ID (legacy)
    // studio.youtube.com/video/ID/... — the Studio URL, which is what gets
    // pasted when somebody is looking AT a video in Studio.
    new RegExp(`\\/video\\/([A-Za-z0-9_-]{11})${B}`),   // /video/ID/edit|translations
  ]
  for (const p of patterns) {
    const m = raw.match(p)
    if (m) return m[1]
  }
  return null
}
