// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CREATOR'S OWN PHOTOS, PLACED IN A POST.
//
// Support, 2026-11-23: "Blog 'Photos' not posting again even though we add
// them." The photos chosen in the Schedule window lived only in the browser and
// were placed by a second request the browser sent AFTER scheduling answered.
// Scheduling waits up to 290 seconds for the post to be written; when that ran
// out (or the tab closed) the post was saved and went live, and the photos were
// never sent anywhere. So the photos now travel with the schedule request and
// are placed by the request that writes the post, right after it saves it
// (app/api/blog/generate), and they are kept on the post (migration 472) so
// "Retry images" places them again instead of AI pictures.
//
// The same placement /api/blog/refresh-images does for its own-photos path:
// re-host each photo on the creator's WordPress, fall back to its public
// address when the site refuses, and spread them at the post's section breaks.

import { gutenbergImageBlock, pickBodyImageOffsets, insertImagesAtOffsets } from '@/lib/blog-body-images'
import { imagesStatusOf } from '@/lib/images-status'

export interface PhotoSite {
  uploadImageFromUrl(src: string, filename: string): Promise<{ source_url?: string | null } | null | undefined>
  updatePost(id: number, patch: { content: string }): Promise<unknown>
}

export type PlacedPhotos =
  | { ok: true; content: string; count: number; hosted: number; placed: number; status: string }
  | { ok: false; error: string }

/** At most this many of the creator's photos in one post (the Schedule window
 *  offers three slots). */
export const MAX_USER_PHOTOS = 3

/** The creator's photo addresses from a request or a saved row: web addresses
 *  only, at most three. Pure. */
export function readUserPhotos(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, MAX_USER_PHOTOS) : []
}

/** Place the photos in `content` and write the post. Never throws. */
export async function placeUserPhotos(opts: { site: PhotoSite; wordpressPostId: number; content: string; title: string | null; slug: string | null; urls: string[] }): Promise<PlacedPhotos> {
  try {
    const urls = readUserPhotos(opts.urls)
    if (!urls.length) return { ok: false, error: 'No photos to place.' }
    const uploaded = (await Promise.all(urls.map(async (src, i) => {
      const alt = `${opts.title || 'product'}, photo ${i + 1}`
      try {
        const media = await opts.site.uploadImageFromUrl(src, `${opts.slug || 'post'}-body${i + 1}.jpg`)
        return media?.source_url ? { url: media.source_url, alt, hosted: true } : { url: src, alt, hosted: false }
      } catch {
        return { url: src, alt, hosted: false }
      }
    })))
    const offsets = pickBodyImageOffsets(opts.content, uploaded.length)
    // A post with fewer section breaks than photos places fewer, and says so:
    // the count is what is IN the post, not what was sent.
    const placed = Math.min(offsets.length, uploaded.length)
    if (placed === 0) return { ok: false, error: 'The post has no place to put the photos (no section breaks found).' }
    const used = uploaded.slice(0, placed)
    const content = insertImagesAtOffsets(opts.content, offsets.slice(0, placed), used.map((img) => gutenbergImageBlock(img.url, img.alt)))
    await opts.site.updatePost(opts.wordpressPostId, { content })
    const hosted = used.filter((u) => u.hosted).length
    return { ok: true, content, count: placed, hosted, placed, status: imagesStatusOf(placed, hosted) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
