// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MATCH MY TIKTOK, ON THE SERVER: a creator's videos kept (tiktok_videos), the
// scan as it really went (tiktok_library), and the brands matched against
// every brand on TRYBE (lib/tiktok-match). Used by the page's route and by the
// daily check. Migration 465.
//
// THE MATCHES ARE KEPT, NOT WORKED OUT ON EVERY LOOK. Every brand on TRYBE,
// with its store's and its TRYBE product names, is several megabytes; reading
// that each time Find brands opens would slow every search. So matches are
// worked out when a scan finishes, again when brands have joined TRYBE since
// (which is how a brand you filmed that joins later is found), and kept on the
// creator's row with when and how far the check got.

import { buildIndex, matchVideos, isMatch, type BrandMatch, type MatchBrand } from './tiktok-match'
import type { TikTokVideo, TikTokProductTag } from './tiktok-videos'
import { readCatalogSamples } from './trybe-top100'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Videos kept per creator: a busy account, many times over. */
export const VIDEOS_MAX = 3000
/** Matches kept on the creator's row (the page shows them all). */
export const MATCHES_KEPT = 400

export interface KeptMatch extends BrandMatch {
  /** When MVP first found this match for this creator. */
  foundAt: string
  /** When the brand first showed up on TRYBE, as MVP saw it. */
  joinedTrybeAt: string | null
}

export function videoToRow(userId: string, handle: string, v: TikTokVideo, source: 'scout' | 'tiktok', now: string) {
  return {
    user_id: userId, video_id: v.id, handle, url: v.url, caption: v.caption, hashtags: v.hashtags, mentions: v.mentions,
    posted_at: v.postedAt, views: v.views, likes: v.likes, cover_url: v.cover, duration: v.duration, products: v.products, source, read_at: now,
  }
}

export function rowToVideo(r: Record<string, unknown>): TikTokVideo {
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  const n = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null)
  return {
    id: String(r.video_id), url: String(r.url || ''), caption: String(r.caption || ''), hashtags: list(r.hashtags), mentions: list(r.mentions),
    postedAt: (r.posted_at as string | null) ?? null, views: n(r.views), likes: n(r.likes), cover: (r.cover_url as string | null) ?? null,
    duration: n(r.duration), products: Array.isArray(r.products) ? (r.products as TikTokProductTag[]) : [],
  }
}

/** Save what a scan read. Returns how many of these MVP already had. */
export async function saveVideos(admin: Db, userId: string, handle: string, videos: TikTokVideo[], source: 'scout' | 'tiktok'): Promise<{ saved: number; known: number; error: string | null }> {
  if (!videos.length) return { saved: 0, known: 0, error: null }
  const ids = videos.map((v) => v.id)
  const { data: had } = await admin.from('tiktok_videos').select('video_id').eq('user_id', userId).in('video_id', ids)
  const known = new Set(((had || []) as Array<{ video_id: string }>).map((r) => r.video_id))
  const now = new Date().toISOString()
  const rows = videos.map((v) => videoToRow(userId, handle, v, source, now))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('tiktok_videos').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,video_id' })
    if (error) return { saved: i, known: known.size, error: error.message }
  }
  return { saved: rows.length, known: ids.filter((id) => known.has(id)).length, error: null }
}

export async function loadVideos(admin: Db, userId: string): Promise<TikTokVideo[]> {
  const out: TikTokVideo[] = []
  for (let from = 0; from < VIDEOS_MAX; from += 1000) {
    const { data, error } = await admin.from('tiktok_videos').select('*').eq('user_id', userId).order('posted_at', { ascending: false, nullsFirst: false }).order('video_id').range(from, from + 999)
    if (error || !data) break
    out.push(...(data as Array<Record<string, unknown>>).map(rowToVideo))
    if (data.length < 1000) break
  }
  return out
}

/** Every brand on TRYBE now, with its TikTok handle and product names, read in
 *  pages. `complete` is false when the time ran out first, and the note says
 *  what was left unchecked, so a short check never looks like a full one. */
export async function loadMatchBrands(admin: Db, deadline: number): Promise<{ brands: MatchBrand[]; firstSeen: Map<string, string>; complete: boolean; note: string | null }> {
  const by = new Map<string, MatchBrand>()
  const firstSeen = new Map<string, string>()
  let complete = true
  for (let from = 0; ; from += 1000) {
    if (Date.now() > deadline) { complete = false; break }
    const { data, error } = await admin.from('trybe_directory').select('brand_id, name, tiktok_handle, site_products, first_seen_at').is('left_at', null).order('brand_id').range(from, from + 999)
    if (error) {
      // Before migration 425 there is no tiktok_handle: read without it.
      if (/tiktok_handle/.test(error.message) && from === 0) {
        const r2 = await admin.from('trybe_directory').select('brand_id, name, site_products, first_seen_at').order('brand_id').range(0, 9999)
        for (const r of (r2.data || []) as Array<Record<string, unknown>>) {
          by.set(String(r.brand_id), { id: String(r.brand_id), name: String(r.name || ''), products: (r.site_products as string[] | null) || [] })
          if (r.first_seen_at) firstSeen.set(String(r.brand_id), String(r.first_seen_at))
        }
        break
      }
      return { brands: [], firstSeen, complete: false, note: `The brands on TRYBE could not be read: ${error.message}` }
    }
    for (const r of (data || []) as Array<Record<string, unknown>>) {
      const id = String(r.brand_id)
      if (!r.name) continue
      by.set(id, { id, name: String(r.name), tiktokHandle: (r.tiktok_handle as string | null) ?? null, products: ((r.site_products as string[] | null) || []).slice(0, 200) })
      if (r.first_seen_at) firstSeen.set(id, String(r.first_seen_at))
    }
    if (!data || data.length < 1000) break
  }
  // TRYBE's own product names for each brand (kept by the daily refresh).
  let catalogsRead = true
  for (let from = 0; ; from += 1000) {
    if (Date.now() > deadline) { catalogsRead = false; break }
    const { data, error } = await admin.from('trybe_directory_meta').select('key, value').like('key', 'samples:%').order('key').range(from, from + 999)
    if (error) { catalogsRead = false; break }
    for (const m of (data || []) as Array<{ key: string; value: unknown }>) {
      const b = by.get(m.key.slice('samples:'.length))
      const names = readCatalogSamples(m.value)?.names
      if (b && names?.length) b.products = [...(b.products || []), ...names]
    }
    if (!data || data.length < 1000) break
  }
  const note = !complete
    ? `Only ${by.size.toLocaleString()} brands on TRYBE were checked before time ran out. The rest are checked on the next look.`
    : !catalogsRead ? 'Brand product names from TRYBE were not all read, so a video naming only a product may be missed this time.' : null
  return { brands: Array.from(by.values()), firstSeen, complete: complete && catalogsRead, note }
}

/** Work the matches out again and keep them on the creator's row, carrying
 *  over when each was first found. */
export async function recomputeMatches(admin: Db, userId: string, opts: { budgetMs?: number } = {}): Promise<{ matches: KeptMatch[]; note: string | null; error: string | null }> {
  const deadline = Date.now() + (opts.budgetMs ?? 25_000)
  const [videos, prev, loaded] = await Promise.all([
    loadVideos(admin, userId),
    admin.from('tiktok_library').select('matches').eq('user_id', userId).maybeSingle(),
    loadMatchBrands(admin, deadline),
  ])
  if (!loaded.brands.length && loaded.note) return { matches: [], note: loaded.note, error: loaded.note }
  const before = new Map<string, string>()
  for (const m of (Array.isArray(prev?.data?.matches) ? prev.data.matches : []) as KeptMatch[]) if (m && m.brandId && m.foundAt) before.set(m.brandId, m.foundAt)
  const now = new Date().toISOString()
  const found = matchVideos(videos, buildIndex(loaded.brands)).slice(0, MATCHES_KEPT)
  const matches: KeptMatch[] = found.map((m) => ({ ...m, foundAt: before.get(m.brandId) ?? now, joinedTrybeAt: loaded.firstSeen.get(m.brandId) ?? null }))
  const { error } = await admin.from('tiktok_library').update({
    matches, matched_brands: matches.filter(isMatch).length, matched_at: now, matched_note: loaded.note, updated_at: now,
  }).eq('user_id', userId)
  return { matches, note: loaded.note, error: error ? error.message : null }
}

/** Whether the kept matches are behind: never worked out, older than a day,
 *  or brands have joined TRYBE since. */
export async function matchesStale(admin: Db, matchedAt: string | null): Promise<boolean> {
  if (!matchedAt) return true
  if (Date.now() - Date.parse(matchedAt) > 24 * 3600_000) return true
  const { count } = await admin.from('trybe_directory').select('brand_id', { count: 'exact', head: true }).gt('first_seen_at', matchedAt)
  return (count ?? 0) > 0
}

/** The brand ids a creator filmed, sure and likely, for Find brands. */
export async function filmedBrandIds(admin: Db, userId: string): Promise<Map<string, { sureness: string; videos: number }>> {
  const out = new Map<string, { sureness: string; videos: number }>()
  const { data, error } = await admin.from('tiktok_library').select('matches').eq('user_id', userId).maybeSingle()
  if (error || !data) return out
  for (const m of (Array.isArray(data.matches) ? data.matches : []) as KeptMatch[]) {
    if (m && m.brandId && isMatch(m)) out.set(m.brandId, { sureness: m.sureness, videos: (m.videoIds || []).length })
  }
  return out
}
