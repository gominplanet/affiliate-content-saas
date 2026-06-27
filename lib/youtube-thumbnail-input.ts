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
import sharp from 'sharp'
import { assertPublicHttpUrl, SsrfBlocked } from '@/lib/ssrf-guard'

export interface ResolvedThumbnail {
  buffer: Buffer
  mimeType: string
  /** Where the buffer came from — diagnostic only. */
  source: 'data-uri' | 'http'
}

/** Maximum size YouTube accepts for a thumbnail upload — 2 MB. */
const YT_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

/**
 * Compress a raw image buffer to JPEG at ≤ 2 MB so YouTube's
 * thumbnails.set API accepts it. gpt-image-1 outputs 1536×1024 PNGs
 * that routinely land at 3–5 MB. We resize to 1280×720 (YouTube's
 * recommended size) and compress to JPEG 90%.
 */
async function compressForYouTube(buffer: Buffer): Promise<{ buffer: Buffer<ArrayBuffer>; mimeType: string }> {
  const compressed = await sharp(buffer)
    .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer() as Buffer<ArrayBuffer>
  return { buffer: compressed, mimeType: 'image/jpeg' }
}

/**
 * Resolve a thumbnail input into a Buffer + mime type, or null if the
 * input isn't a recognized format.
 *
 * Throws when an HTTPS URL was provided but the fetch failed — so the
 * caller can surface "Thumbnail upload failed: …" instead of silently
 * dropping the user's image. Returns null only for unparseable input.
 *
 * Oversized images (> 2 MB) are automatically recompressed to JPEG at
 * 1280×720 / 90% quality rather than throwing — gpt-image-1 PNGs
 * routinely exceed the 2 MB YouTube limit.
 */
export async function resolveThumbnailInput(input: string): Promise<ResolvedThumbnail | null> {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  // ── Path 1: data URI ────────────────────────────────────────────
  const dataMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/)
  if (dataMatch) {
    const mimeType = dataMatch[1]
    let buffer = Buffer.from(dataMatch[2], 'base64')
    if (buffer.byteLength > YT_THUMBNAIL_MAX_BYTES) {
      const result = await compressForYouTube(buffer)
      buffer = result.buffer
      return { buffer, mimeType: result.mimeType, source: 'data-uri' }
    }
    return { buffer, mimeType, source: 'data-uri' }
  }

  // ── Path 2: HTTPS URL ───────────────────────────────────────────
  if (/^https?:\/\//i.test(trimmed)) {
    // SSRF guard: this URL ultimately originates from the request body
    // (thumbnailDataUri), so an attacker could point it at an internal
    // service or a cloud-metadata endpoint. Reject private/reserved
    // hosts before we ever open the socket. We also re-check the final
    // URL after redirects below, in case a public host 30x-redirects
    // into private space.
    try {
      assertPublicHttpUrl(trimmed)
    } catch (e) {
      if (e instanceof SsrfBlocked) throw new Error(`Thumbnail URL rejected: ${e.message}`)
      throw e
    }
    const res = await fetch(trimmed, {
      // Identify ourselves so storage providers don't reject us as
      // a bot, and bound the request so a slow CDN can't stall the
      // YouTube upload chain.
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (MVP Affiliate)' },
    })
    // A public host can still redirect into private space — re-validate
    // where we actually landed.
    if (res.url && res.url !== trimmed) {
      try {
        assertPublicHttpUrl(res.url)
      } catch (e) {
        if (e instanceof SsrfBlocked) throw new Error(`Thumbnail URL redirected to a blocked host.`)
        throw e
      }
    }
    if (!res.ok) {
      throw new Error(`Thumbnail fetch failed (${res.status}) from ${trimmed.slice(0, 80)}`)
    }
    const ab = await res.arrayBuffer()
    let buffer = Buffer.from(ab)

    // Prefer the server's Content-Type; sniff from the URL only when
    // the response doesn't disclose one (some CDNs send octet-stream).
    let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (!mimeType || mimeType === 'application/octet-stream') {
      if (/\.png(\?|$)/i.test(trimmed)) mimeType = 'image/png'
      else if (/\.jpe?g(\?|$)/i.test(trimmed)) mimeType = 'image/jpeg'
      else if (/\.webp(\?|$)/i.test(trimmed)) mimeType = 'image/webp'
      else mimeType = 'image/png'
    }

    // gpt-image-1 returns 1536×1024 PNGs that are typically 3–5 MB —
    // above YouTube's 2 MB ceiling. Recompress to JPEG 1280×720
    // automatically so the upload always lands.
    if (buffer.byteLength > YT_THUMBNAIL_MAX_BYTES) {
      const result = await compressForYouTube(buffer)
      buffer = result.buffer
      mimeType = result.mimeType
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
