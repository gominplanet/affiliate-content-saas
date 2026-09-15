// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What the `product-images` storage bucket will actually hold (migration 051).
// Its own module so the limits, the converter and the route cannot drift apart
// into three different opinions about the same bucket.

/** The bucket's allowed_mime_types. Anything else gets converted, not refused. */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Under the bucket's own 10 MB ceiling, so our limit is the one that speaks. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function isAllowedImageMime(mime: string): boolean {
  return (ALLOWED_IMAGE_MIME as readonly string[]).includes((mime || '').toLowerCase().trim())
}

/** File extension for a mime type, for the storage path. Only the three the
 *  bucket accepts — a .gif path would name a file storage will never hold. */
export function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  return 'jpg'
}
