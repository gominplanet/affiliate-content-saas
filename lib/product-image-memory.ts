// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// ONE APPROVED IMAGE PER PRODUCT, recalled across every surface.
//
// The cost case for caching generated images was measured and does not exist:
// avg_touches_per_product came back at 1.10 over 90 days and total image spend
// across every product feature was $1.44. Nobody comes back to the same ASIN
// often enough for a cache to pay for anything.
//
// The RECALL case is different and is why this exists:
//
//   1. A thumbnail the creator UPLOADED is not reproducible. Co-Pilot read it
//      into a data URI in browser state (handleThumbnailUpload) and threw it
//      away the moment it was pushed to YouTube. Regenerating cannot get it
//      back, because it was never ours.
//   2. Posting the same product to YouTube on Monday and Facebook on Tuesday
//      should look like the same creator. Rolling fresh art each time is not
//      cheaper OR better, it is just inconsistent.
//
// So this is a POINTER, not a cache. (user_id, asin) → the last image the
// creator approved, wherever they approved it. Approving a new one replaces
// it. Nothing here decides to reuse anything on its own: every read surface
// shows the image, says where and when it came from, and leaves a one-click
// way to make a new one.
//
// Note what is deliberately NOT keyed here: headline text, aspect ratio, face
// model. A key that included them would miss on nearly every read (the whole
// reason the cost case failed), and the creator asking for "the image I
// approved for this product" does not mean "the image I approved for this
// product at this exact headline".
import 'server-only'
import { randomUUID } from 'node:crypto'

/** Bucket already public + per-user RLS on the first path segment. */
export const PRODUCT_IMAGE_BUCKET = 'headshots'

// The label/record shape lives in lib/product-image-label so the browser
// composers can render the same sentence this module reasons about — this file
// is server-only and cannot be imported from a client component.
export {
  STALE_AFTER_DAYS, daysBetween, reuseLabel, isAsin,
} from '@/lib/product-image-label'
export type { ProductImageSource, ProductImageRecord, ReuseLabel } from '@/lib/product-image-label'

import { isAsin } from '@/lib/product-image-label'
import type { ProductImageSource, ProductImageRecord } from '@/lib/product-image-label'

/** Storage path for a persisted copy. user id first so the bucket RLS passes. */
export function productImagePath(userId: string, asin: string, ext: string): string {
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : 'jpg'
  return `${userId}/product-images/${asin}-${randomUUID()}.${safeExt}`
}

/** File extension for a mime type, for the storage path. */
export function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'jpg'
}

/** `data:image/png;base64,...` → bytes, or null when it isn't one. */
export function parseImageDataUri(input: string): { buffer: Buffer; mimeType: string } | null {
  const m = (input || '').trim().match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  if (!m) return null
  try {
    return { buffer: Buffer.from(m[2], 'base64'), mimeType: m[1].toLowerCase() }
  } catch {
    return null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Persist bytes into storage and point (user, asin) at them.
 *
 * Always stores OUR OWN copy rather than the URL we were handed. fal.media
 * links expire, and the whole promise of this feature is that the image is
 * still there next month. Best-effort by design: a creator's YouTube push must
 * never fail because we could not remember a picture. Returns null on failure
 * and logs, so a silent no-op is still visible in the logs.
 */
export async function rememberProductImage(opts: {
  db: any
  userId: string
  asin: string
  buffer: Buffer
  mimeType: string
  source: ProductImageSource
  surface?: string | null
  modelUsed?: string | null
}): Promise<string | null> {
  const asin = opts.asin.trim().toUpperCase()
  if (!isAsin(asin)) return null
  try {
    const path = productImagePath(opts.userId, asin, extForMime(opts.mimeType))
    const { error: upErr } = await opts.db.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, opts.buffer, { contentType: opts.mimeType, upsert: false, cacheControl: '31536000' })
    if (upErr) {
      console.error('[product-image-memory] upload failed', upErr.message)
      return null
    }
    const publicUrl = opts.db.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl as string
    const { error: dbErr } = await opts.db.from('product_images').upsert({
      user_id: opts.userId,
      asin,
      image_url: publicUrl,
      source: opts.source,
      surface: opts.surface ?? null,
      model_used: opts.modelUsed ?? null,
      approved_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asin' })
    if (dbErr) {
      console.error('[product-image-memory] upsert failed', dbErr.message)
      return null
    }
    return publicUrl
  } catch (err) {
    console.error('[product-image-memory] remember failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** The approved image for a product, or null. Never throws. */
export async function recallProductImage(db: any, userId: string, asin: string): Promise<ProductImageRecord | null> {
  const key = (asin || '').trim().toUpperCase()
  if (!isAsin(key)) return null
  try {
    // select('*'), not a column list: PostgREST rejects the WHOLE statement when
    // one named column is missing, and until migration 331 is applied on an
    // environment this table has no columns at all. A recall that 400s must
    // degrade to "no saved image", never to a broken composer.
    const { data, error } = await db.from('product_images')
      .select('*').eq('user_id', userId).eq('asin', key).maybeSingle()
    if (error || !data) return null
    return {
      asin: key,
      imageUrl: data.image_url as string,
      source: (data.source === 'upload' ? 'upload' : 'generated') as ProductImageSource,
      surface: (data.surface as string | null) ?? null,
      modelUsed: (data.model_used as string | null) ?? null,
      approvedAt: (data.approved_at as string) || (data.created_at as string) || new Date().toISOString(),
    }
  } catch {
    return null
  }
}
