// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHY 186 POSTS ENDED UP POINTING AT OUR IMAGE SERVER.
//
// Measured on 40 hot-linked images taken from the affected posts, oldest first:
//
//   28 JPEGs   mean  0.20 MB   max  0.37 MB   every one of them uploaded fine
//   12 PNGs    mean 17.83 MB   max 22.48 MB   every one of them failed
//
// A perfect split, and nothing to do with the creators' hosts. Two defects,
// both ours, and each one is enough on its own.
//
// THE NAME DISAGREES WITH THE BYTES. Every body image is uploaded as
// `${slug}-body1.jpg`, whatever the generator actually returned. The first body
// image of every post goes through fal-ai/aura-sr for a 4x upscale, and that
// returns PNG. So we POST image/png under a .jpg name, and WordPress's
// wp_check_filetype_and_ext rejects an extension that disagrees with the real
// file type. Deterministic, every time, on every host.
//
// AND THE FILE IS ENORMOUS. 4x on a 1024x768 render is 4096x3072, which is 15
// to 22 MB of PNG. PHP ships with upload_max_filesize at 2 MB and hosts
// commonly allow 8 to 64 MB, so even with the right name most of these would be
// refused. For a picture that is displayed about 700px wide in an article.
//
// So: the extension is derived from the bytes rather than from a guess, and an
// oversized image is resized before it is sent. Transparency is preserved
// rather than flattened, because a PNG with alpha turned into a JPEG gains a
// black background, and the logo and sticker paths use this same upload.
//
// The decision is separated from the doing so it can be checked without sharp,
// a network, or a WordPress site.

/** Over this, resize before sending. Comfortably under PHP's common ceilings
 *  while leaving a real photograph untouched. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** An article image is displayed around 700px wide. 2048 is generous for
 *  retina and still an order of magnitude smaller than a 4x upscale. */
export const MAX_UPLOAD_WIDTH = 2048

export const JPEG_QUALITY = 82

export interface SourceImage {
  /** Content-Type as the source served it. Null when it said nothing. */
  contentType: string | null
  byteLength: number
  /** Whether the image carries transparency. Undefined when not yet known. */
  hasAlpha?: boolean
}

export type UploadPlan =
  | { action: 'as-is'; filename: string; contentType: string }
  | { action: 'resize'; filename: string; contentType: string; maxWidth: number; quality: number }

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** The real type, with parameters and casing stripped. */
export function normaliseType(contentType: string | null | undefined): string | null {
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  return t.startsWith('image/') ? t : null
}

/** The extension the bytes deserve, which is not always the one asked for. */
export function extensionFor(contentType: string | null | undefined): string | null {
  const t = normaliseType(contentType)
  return t ? (EXT_BY_TYPE[t] ?? null) : null
}

/** Swap a filename's extension, keeping everything before the last dot. */
export function withExtension(filename: string, ext: string): string {
  const base = String(filename ?? 'image').replace(/\?.*$/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const safe = (base || 'image').slice(0, 120)
  return `${safe}.${ext}`
}

/**
 * What should actually be sent for this image.
 *
 * The filename always ends up matching the bytes. That alone is the difference
 * between a media upload WordPress accepts and one it refuses for security
 * reasons, and it is the reason every upscaled hero image in the affected posts
 * failed while its sibling succeeded.
 *
 * An unrecognised type is left completely alone: guessing an extension for
 * something we cannot identify would be swapping one mismatch for another.
 */
export function planUpload(requestedFilename: string, src: SourceImage): UploadPlan {
  const type = normaliseType(src.contentType)
  const ext = extensionFor(type)

  if (!type || !ext) {
    return { action: 'as-is', filename: requestedFilename, contentType: src.contentType || 'application/octet-stream' }
  }

  const bytes = Number.isFinite(src.byteLength) ? src.byteLength : 0

  if (bytes <= MAX_UPLOAD_BYTES) {
    return { action: 'as-is', filename: withExtension(requestedFilename, ext), contentType: type }
  }

  // Too big to rely on a host accepting it. Transparency decides what it
  // becomes: a PNG with alpha stays a PNG, because flattening a sticker or a
  // logo onto a background is a worse outcome than a larger file. Animation is
  // left alone entirely; resizing a GIF here would silently drop its frames.
  if (type === 'image/gif') {
    return { action: 'as-is', filename: withExtension(requestedFilename, ext), contentType: type }
  }

  const keepAlpha = src.hasAlpha === true
  const outType = keepAlpha ? 'image/png' : 'image/jpeg'
  const outExt = keepAlpha ? 'png' : 'jpg'

  return {
    action: 'resize',
    filename: withExtension(requestedFilename, outExt),
    contentType: outType,
    maxWidth: MAX_UPLOAD_WIDTH,
    quality: JPEG_QUALITY,
  }
}

/** Said out loud in the log, because "upload failed" taught nobody anything
 *  for four months. */
export function describePlan(plan: UploadPlan, src: SourceImage): string {
  const mb = (src.byteLength / 1048576).toFixed(2)
  if (plan.action === 'resize') {
    return `resizing ${mb} MB ${normaliseType(src.contentType) ?? 'image'} to at most ${plan.maxWidth}px as ${plan.filename}`
  }
  return `sending ${mb} MB as ${plan.filename}`
}
