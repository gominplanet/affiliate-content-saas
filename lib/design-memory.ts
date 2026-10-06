// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DESIGN MEMORY: the last pin, Instagram post, Facebook post, story or Shorts
// cover MVP made for a product, one per format (migration 404).
//
// The 16:9 thumbnail has its own memory (lib/product-image-memory). The other
// shapes were only kept once posted, so a pin made and not posted was gone and
// the next one was paid for again. Now every design MVP renders is kept against
// the product and its format, as MVP's own copy (fal links expire), and offered
// back by the composers and by made-before.
//
// Best-effort like the image memory: a render never fails because it could not
// be remembered, and a recall that fails reads as "nothing saved".

import { PRODUCT_IMAGE_BUCKET, normalizeForStorage, extForMime } from '@/lib/product-image-memory'
import { isAsin } from '@/lib/product-image-label'
import { randomUUID } from 'node:crypto'
import { isDesignFormat, type DesignFormat } from '@/lib/design-formats'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export { DESIGN_FORMATS, DESIGN_FORMAT_LABEL, isDesignFormat, type DesignFormat } from '@/lib/design-formats'

export interface DesignRecord { asin: string; format: DesignFormat; imageUrl: string; surface: string | null; createdAt: string }

/** Keep a rendered design against its product and format. Returns MVP's URL or null. */
export async function rememberDesign(o: {
  db: Db; userId: string; asin: string; format: string; imageUrl: string; surface?: string | null; modelUsed?: string | null
}): Promise<string | null> {
  const asin = (o.asin || '').trim().toUpperCase()
  if (!isAsin(asin) || !isDesignFormat(o.format) || !/^https?:\/\//i.test(o.imageUrl)) return null
  try {
    const { assertPublicHttpUrl } = await import('@/lib/ssrf-guard')
    assertPublicHttpUrl(o.imageUrl)
    const res = await fetch(o.imageUrl, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0 (MVP Affiliate)' } })
    if (!res.ok) return null
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'image/jpeg'
    const norm = await normalizeForStorage(Buffer.from(await res.arrayBuffer()), mime)
    if (!norm) return null
    const path = `${o.userId}/designs/${asin}-${o.format}-${randomUUID()}.${extForMime(norm.mimeType)}`
    const { error: upErr } = await o.db.storage.from(PRODUCT_IMAGE_BUCKET)
      .upload(path, norm.buffer, { contentType: norm.mimeType, upsert: false, cacheControl: '31536000' })
    if (upErr) { console.error('[design-memory] upload failed', upErr.message); return null }
    const url = o.db.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl as string
    const { error } = await o.db.from('product_designs').upsert({
      user_id: o.userId, asin, format: o.format, image_url: url,
      surface: o.surface ?? null, model_used: o.modelUsed ?? null, created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,asin,format' })
    if (error) { console.error('[design-memory] upsert failed', error.message); return null }
    return url
  } catch (e) {
    console.error('[design-memory] remember failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Every design kept for a product (or one format of it), newest first. */
export async function recallDesigns(db: Db, userId: string, asin: string, format?: DesignFormat): Promise<DesignRecord[]> {
  const key = (asin || '').trim().toUpperCase()
  if (!isAsin(key)) return []
  try {
    let q = db.from('product_designs').select('*').eq('user_id', userId).eq('asin', key)
    if (format) q = q.eq('format', format)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error || !data) return []
    return (data as Array<Record<string, unknown>>).filter((r) => isDesignFormat(r.format)).map((r) => ({
      asin: key, format: r.format as DesignFormat, imageUrl: String(r.image_url),
      surface: (r.surface as string | null) ?? null, createdAt: String(r.created_at || ''),
    }))
  } catch { return [] }
}
