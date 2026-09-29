// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DUPLICATE THUMBNAILS IN A CREATOR'S MEDIA LIBRARY, found and removed.
//
// The thumbnail heal job read "does this post have an image?" with a request
// WordPress refuses, took every answer as "unknown", and re-uploaded the
// YouTube thumbnail of the newest forty posts every six hours (fixed in
// lib/reattach-thumbnails). One creator ended up with the same thumbnail 65
// times and about two thousand copies in all. This finds them and takes them
// back out.
//
// WHAT COUNTS AS A DUPLICATE, all of these at once:
//   - its file is named after one of the creator's own YouTube videos, the way
//     MVP names them (<videoId>.jpg, <videoId>-blogthumb.jpg, and WordPress's
//     -1, -2, ... on repeats);
//   - it is not attached to a post (images placed in an article are);
//   - no post or page uses it as its featured image;
//   - and it is not the last copy: when no copy of a video's thumbnail is in
//     use, the newest one is kept anyway.
// Anything else in the library is never looked at twice.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wp = any

type Media = { id: number; date: string; post: number | null; source_url: string }

/** The YouTube video a file was named after, or null. */
export function videoIdOfFile(url: string, videoIds: Set<string>): string | null {
  const name = decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '')
  const stem = name.replace(/\.(jpe?g|png|webp)$/i, '')
  if (stem === name) return null
  const tries = [stem]
  const noNum = stem.replace(/-\d+$/, '')
  tries.push(noNum)
  tries.push(noNum.replace(/-blogthumb$/, ''), stem.replace(/-blogthumb$/, ''))
  for (const t of tries) if (videoIds.has(t)) return t
  return null
}

async function allPages<T>(wp: Wp, path: string, maxPages: number): Promise<T[]> {
  const first = await wp.readPage(`${path}&page=1`) as { data: T[]; totalPages: number }
  const out: T[] = [...(first.data ?? [])]
  const pages = Math.min(first.totalPages || 1, maxPages)
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
  for (let i = 0; i < rest.length; i += 4) {
    const got = await Promise.all(rest.slice(i, i + 4).map((n) => wp.readPage(`${path}&page=${n}`).then((r: { data: T[] }) => r.data ?? [])))
    for (const g of got) out.push(...g)
  }
  return out
}

/** Featured images in use on every post and page, of any status. */
async function inUse(wp: Wp): Promise<Set<number>> {
  const used = new Set<number>()
  for (const type of ['posts', 'pages']) {
    const rows = await allPages<{ featured_media?: number }>(wp, `/${type}?status=any&context=edit&_fields=id,featured_media&per_page=100`, 100)
    for (const r of rows) if (r.featured_media) used.add(r.featured_media)
  }
  return used
}

export async function findDuplicateThumbnails(wp: Wp, videoIds: Set<string>): Promise<{ ids: number[]; scanned: number; videos: number }> {
  const used = await inUse(wp)
  const media = await allPages<Media>(wp, `/media?_fields=id,date,post,source_url&per_page=100&orderby=date&order=desc`, 200)
  const byVideo = new Map<string, Media[]>()
  for (const m of media) {
    const v = videoIdOfFile(m.source_url, videoIds)
    if (v) byVideo.set(v, [...(byVideo.get(v) ?? []), m])
  }
  const ids: number[] = []
  for (const copies of byVideo.values()) {
    const free = copies.filter((m) => !m.post && !used.has(m.id))
    // The last copy stays, even when nothing uses it.
    const keepNewest = copies.every((m) => !used.has(m.id) && !m.post)
    const sorted = free.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    ids.push(...(keepNewest ? sorted.slice(1) : sorted).map((m) => m.id))
  }
  return { ids, scanned: media.length, videos: byVideo.size }
}

/**
 * Delete these ids, each checked again just before: still a thumbnail file of
 * one of the creator's videos, still unattached, still nobody's featured
 * image. Stops at the deadline and says how many are left.
 */
export async function removeDuplicateThumbnails(wp: Wp, ids: number[], videoIds: Set<string>, deadline: number): Promise<{ removed: number; skipped: number; failed: number; left: number[] }> {
  const used = await inUse(wp)
  let removed = 0, skipped = 0, failed = 0
  const queue = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0)
  const left: number[] = []
  for (let i = 0; i < queue.length; i += 100) {
    const part = queue.slice(i, i + 100)
    if (Date.now() > deadline) { left.push(...part); continue }
    const { data } = await wp.readPage(`/media?include=${part.join(',')}&_fields=id,post,source_url&per_page=100`) as { data: Media[] }
    const ok = new Map((data ?? []).map((m) => [m.id, m]))
    for (const id of part) {
      if (Date.now() > deadline) { left.push(id); continue }
      const m = ok.get(id)
      if (!m || m.post || used.has(id) || !videoIdOfFile(m.source_url, videoIds)) { skipped++; continue }
      try { await wp.deleteMedia(id); removed++ } catch { failed++ }
    }
  }
  return { removed, skipped, failed, left }
}
