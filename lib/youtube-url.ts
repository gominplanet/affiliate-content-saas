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
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,          // watch?v=ID
    /youtu\.be\/([A-Za-z0-9_-]{11})/,     // youtu.be/ID
    /\/shorts\/([A-Za-z0-9_-]{11})/,      // /shorts/ID
    /\/embed\/([A-Za-z0-9_-]{11})/,       // /embed/ID
    /\/live\/([A-Za-z0-9_-]{11})/,        // /live/ID
    /\/v\/([A-Za-z0-9_-]{11})/,           // /v/ID (legacy)
  ]
  for (const p of patterns) {
    const m = raw.match(p)
    if (m) return m[1]
  }
  return null
}
