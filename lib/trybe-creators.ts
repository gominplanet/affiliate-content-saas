// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TOP CREATORS IN TRYBE'S TOP 100 (Seb, 2026-10-17: "do ... four", after
// TrybeDaily's "Trybe 25"). The creators behind the videos TRYBE picked for
// its Top 100 right now, from the same read as What's working: how many of
// their videos are in it, their best place, the brands, and the videos to
// watch. TRYBE's own sales range for a creator shows only when TRYBE sends
// it with the Top 100; MVP never estimates a creator's sales. Pure, so it is
// tested (scripts/test-trybe-board.ts).

import type { TopVideoEntry } from '@/lib/trybe-working'

export interface TopCreator {
  name: string
  handle: string | null
  avatar: string | null
  /** TRYBE's sales range for them, when sent. */
  sales: string | null
  videos: number
  best: number | null
  brands: Array<{ id: string | null; name: string }>
  clips: Array<{ id: string | null; rank: number | null; thumbnail: string | null; video: string | null; brand: string | null }>
}

/** Videos grouped by creator: most videos in the Top 100 first, then the best
 *  place. A video with no creator name is left out, not filed under "Unknown". Pure. */
export function topCreators(entries: TopVideoEntry[]): TopCreator[] {
  const by = new Map<string, TopCreator>()
  for (const e of entries) {
    const name = (e.creator || '').trim()
    if (!name) continue
    const key = (e.creatorHandle || name).toLowerCase()
    const c = by.get(key) ?? { name, handle: e.creatorHandle ?? null, avatar: e.creatorAvatar ?? null, sales: e.creatorSales ?? null, videos: 0, best: null, brands: [], clips: [] }
    c.videos++
    if (e.rank != null && (c.best == null || e.rank < c.best)) c.best = e.rank
    if (!c.avatar && e.creatorAvatar) c.avatar = e.creatorAvatar
    if (!c.sales && e.creatorSales) c.sales = e.creatorSales
    const brand = e.brandName || null
    if (brand && !c.brands.some((b) => b.name.toLowerCase() === brand.toLowerCase())) c.brands.push({ id: e.brandId, name: brand })
    c.clips.push({ id: e.id, rank: e.rank, thumbnail: e.thumbnail, video: e.video, brand })
    by.set(key, c)
  }
  return Array.from(by.values())
    .map((c) => ({ ...c, clips: c.clips.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)) }))
    .sort((a, b) => b.videos - a.videos || (a.best ?? 999) - (b.best ?? 999) || a.name.localeCompare(b.name))
}
