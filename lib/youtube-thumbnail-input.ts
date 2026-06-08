// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Normalize whatever the YouTube apply / update-metadata routes get
// passed as `thumbnailDataUri` into a Buffer + mime type ready for
// YouTube's videos.set_thumbnail API.
//
// The field is named `thumbnailDataUri` but in practice the studio
// frontend sends one of three shapes:
//
//   1. `data:image/png;base64,...`       (user uploaded a local file)
//   2. `https://fal.media/.../x.png`     (AI generation result)
//   3. `https://...supabase.co/.../x.png` (uploaded variant)
//
// The original implementation only handled #1 via a regex match. When
// the AI thumbnail generator returned an HTTPS URL, the regex didn't
// match, the `if (match)` branch was silently skipped, the metadata
// update succeeded, and the user saw "Saved to draft" but the
// thumbnail was never pushed to YouTube.
//
// 2026-06-07: shipped after the user reported "thumbnail does not get
// saved within youtube".
import 'server-only'

export interface ResolvedThumbnail {
  buffer: Buffer
  mimeType: string
  /** Where the buffer came from — diagnostic only. */
  source: 'data-uri' | 'http'
}

/** Maximum size YouTube accepts for a thumbnail upload — 2 MB. We
 *  defensively bound HTTP fetches at this size to fail-fast on rogue
 *  large images instead of trickling a multi-megabyte download into
 *  the YouTube API. */
const YT_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

/**
 * Resolve a thumbnail input into a Buffer + mime type, or null if the
 * input isn't a recognized format.
 *
 * Throws when an HTTPS URL was provided but the fetch failed — so the
 * caller can surface "Thumbnail upload failed: …" instead of silently
 * dropping the user's image. Returns null only for unparseable input.
 */
export async function resolveThumbnailInput(input: string): Promise<ResolvedThumbnail | null> {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  // ── Path 1: data URI ────────────────────────────────────────────
  const dataMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/)
  if (dataMatch) {
    const mimeType = dataMatch[1]
    const buffer = Buffer.from(dataMatch[2], 'base64')
    return { buffer, mimeType, source: 'data-uri' }
  }

  // ── Path 2: HTTPS URL ───────────────────────────────────────────
  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed, {
      // Identify ourselves so storage providers don't reject us as
      // a bot, and bound the request so a slow CDN can't stall the
      // YouTube upload chain.
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (MVP Affiliate)' },
    })
    if (!res.ok) {
      throw new Error(`Thumbnail fetch failed (${res.status}) from ${trimmed.slice(0, 80)}`)
    }
    const ab = await res.arrayBuffer()
    const buffer = Buffer.from(ab)
    if (buffer.byteLength > YT_THUMBNAIL_MAX_BYTES) {
      throw new Error(`Thumbnail too large for YouTube (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB, max 2 MB)`)
    }
    // Prefer the server's Content-Type; sniff from the URL only when
    // the response doesn't disclose one (some CDNs send octet-stream).
    let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (!mimeType || mimeType === 'application/octet-stream') {
      if (/\.png(\?|$)/i.test(trimmed)) mimeType = 'image/png'
      else if (/\.jpe?g(\?|$)/i.test(trimmed)) mimeType = 'image/jpeg'
      else if (/\.webp(\?|$)/i.test(trimmed)) mimeType = 'image/webp'
      else mimeType = 'image/png' // YouTube accepts PNG/JPG/GIF/BMP; pick a safe default
    }
    return { buffer, mimeType, source: 'http' }
  }

  // ── Unknown format — return null so the caller can warn the user
  //    instead of silently skipping (the old silent-skip behavior was
  //    the root cause of the "thumbnail not saved" report). The
  //    caller is expected to translate null into a user-visible
  //    warning when the field was non-empty.
  return null
}
