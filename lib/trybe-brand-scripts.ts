// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR BRANDS' TOP VIDEOS, WORD FOR WORD (Seb, 2026-10-20: "go through the
// users already accepted brands and look at the top videos ... mvp already
// gives ten script ideas but what if we also gave users the exact scripts of
// the top videos").
//
// Each brand a creator has joined lists its top videos on its TRYBE page,
// each with a video file. SCOUT reads every joined brand's page from the
// creator's own TRYBE tab, MVP files the videos in the shared copy
// (trybe_top_scripts, the same store How they win and the ten ideas read),
// and the transcription job writes down what is said in each, once in the
// life of the product, for everyone who works with that brand.
//
// A MEMBER'S FILING ONLY ADDS. A row already there is never overwritten (only
// a waiting one gets the fresh file link, as TRYBE's links expire), and a
// file is listened to only when it is on a host TRYBE's own Top 100 files
// came from, so nobody can have MVP transcribe a file of their choosing.
// Pure, tested in scripts/test-trybe-brand-scripts.

/** Brands read in one pass, and videos kept per brand. */
export const BRAND_SCRIPTS_MAX_BRANDS = 40
export const BRAND_SCRIPTS_PER_BRAND = 12

export interface FiledVideo { id: string; video: string | null; thumbnail: string | null; caption: string | null }
export interface FiledBrand { brandId: string; brandName: string; videos: FiledVideo[] }

const ID = /^[A-Za-z0-9_-]{4,120}$/

/** The host a link is on, or null when it is not an https link. */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 1000) return null
  try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname.toLowerCase() : null } catch { return null }
}

/** A file MVP may listen to or show: https, on a host TRYBE's own files came
 *  from (`hosts`, read from the team's Top 100 filing) or on TRYBE itself. */
export function mediaOk(url: unknown, hosts: ReadonlySet<string>): boolean {
  const h = hostOf(url)
  return !!h && (hosts.has(h) || h === 'jointrybe.com' || h.endsWith('.jointrybe.com'))
}

/** What a page sent, made safe to file: ids checked, sizes capped, links kept
 *  only when MVP may use them. Pure. */
export function cleanFiling(raw: unknown, hosts: ReadonlySet<string>): FiledBrand[] {
  const out: FiledBrand[] = []
  for (const b of (Array.isArray(raw) ? raw : []).slice(0, BRAND_SCRIPTS_MAX_BRANDS)) {
    if (!b || typeof b !== 'object') continue
    const o = b as Record<string, unknown>
    const brandId = typeof o.brandId === 'string' && ID.test(o.brandId) ? o.brandId : null
    if (!brandId) continue
    const brandName = typeof o.brandName === 'string' ? o.brandName.trim().slice(0, 160) : ''
    const seen = new Set<string>()
    const videos: FiledVideo[] = []
    for (const v of (Array.isArray(o.videos) ? o.videos : []).slice(0, BRAND_SCRIPTS_PER_BRAND * 2)) {
      if (!v || typeof v !== 'object') continue
      const x = v as Record<string, unknown>
      const id = typeof x.id === 'string' && ID.test(x.id) ? x.id : null
      if (!id || seen.has(id)) continue
      seen.add(id)
      videos.push({
        id,
        video: mediaOk(x.video, hosts) ? String(x.video) : null,
        thumbnail: mediaOk(x.thumbnail, hosts) ? String(x.thumbnail) : null,
        caption: typeof x.caption === 'string' ? x.caption.trim().slice(0, 300) || null : null,
      })
      if (videos.length >= BRAND_SCRIPTS_PER_BRAND) break
    }
    out.push({ brandId, brandName, videos })
  }
  return out
}

export interface ScriptRow {
  submission_id: string; brand_id: string | null; brand_name: string | null
  video_url: string | null; thumbnail: string | null
  script: string | null; hook: string | null
  source: string; state: string; detail: string | null
  best_rank: number | null
}

/** Where a video's words came from, or why there are none, in words. */
export function wordsFrom(r: Pick<ScriptRow, 'state' | 'source' | 'detail' | 'video_url'>): { tone: 'ok' | 'wait' | 'none'; text: string } {
  if (r.state === 'ready') return { tone: 'ok', text: r.source === 'transcribed' ? 'Written down by MVP from the video' : 'TRYBE’s own words for this video' }
  if (r.state === 'waiting') return r.video_url
    ? { tone: 'wait', text: 'Being written down. MVP listens to each video once, within a day or two.' }
    : { tone: 'none', text: 'TRYBE gave no video file MVP can listen to.' }
  return { tone: 'none', text: r.detail ? r.detail.replace(/\.$/, '') + '.' : 'No words: MVP tried and heard none.' }
}

/** Counts for the heading, over the rows shown. */
export function scriptCounts(rows: Array<Pick<ScriptRow, 'state' | 'video_url'>>): { videos: number; ready: number; waiting: number; none: number } {
  let ready = 0, waiting = 0, none = 0
  for (const r of rows) {
    if (r.state === 'ready') ready++
    else if (r.state === 'waiting' && r.video_url) waiting++
    else none++
  }
  return { videos: rows.length, ready, waiting, none }
}
