// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Making an image storable instead of refusing it.
//
// Split out of lib/product-image-memory (which is marked 'server-only', and so
// cannot be imported by a plain tsx test run) so scripts/test-product-image-memory
// can exercise this against real encoded bytes rather than asserting that a
// regex mentions sharp. Still server-side only in practice — it needs sharp.
import sharp from 'sharp'
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES, isAllowedImageMime } from '@/lib/product-image-limits'

export { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES, isAllowedImageMime }

/**
 * Make bytes storable, rather than refusing them.
 *
 * Co-Pilot's uploader accepts JPG, PNG, GIF and BMP; this bucket holds only
 * png/jpeg/webp. Refusing the creator's own GIF would drop the exact image
 * this feature exists to keep — the one no amount of regenerating brings back
 * — so anything the bucket will not take, and anything over the ceiling, is
 * converted to JPEG instead. Bytes already fine are passed through untouched.
 *
 * The decode is not optional even on the pass-through path. Storage trusts the
 * declared content type and does not look at the bytes, so an HTML error page
 * served as image/png would upload happily and leave the recall pointing at a
 * file that every social network then fails to fetch. A saved image that is
 * not an image is worse than no saved image, so it must not be recorded.
 *
 * Returns null when the bytes are not a decodable image.
 */
export async function normalizeForStorage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let decodable = false
  try {
    const meta = await sharp(buffer).metadata()
    decodable = !!meta.width && !!meta.height
  } catch {
    decodable = false
  }
  if (!decodable) return null

  if (isAllowedImageMime(mimeType) && buffer.byteLength <= MAX_IMAGE_BYTES) {
    return { buffer, mimeType: mimeType.toLowerCase().trim() }
  }
  try {
    const out = await sharp(buffer)
      // Cap the long edge so an oversized render lands under the ceiling
      // without throwing away a normal-sized one.
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    if (out.byteLength > MAX_IMAGE_BYTES) return null
    return { buffer: Buffer.from(out), mimeType: 'image/jpeg' }
  } catch {
    return null
  }
}
