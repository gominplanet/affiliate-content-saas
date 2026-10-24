// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT'S WORKING ON TRYBE (Seb, 2026-10-13, screenshots of TrybeDaily's
// "What's Working"): the videos TRYBE picked for its Top 100, read through
// SCOUT from the creator's own TRYBE, and how their opening lines start.
// Pure, so the reading and the counting are tested (scripts/test-trybe-working.ts).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const first = (o: Obj, keys: string[]): unknown => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return undefined }

export interface TopVideoEntry {
  /** The submission's id, for its words (GET submissions/{id}/script). */
  id: string | null
  rank: number | null
  brandId: string | null
  brandName: string | null
  brandLogo: string | null
  category: string | null
  creator: string | null
  /** The creator's handle, picture and TRYBE's sales range for them, when TRYBE sends them. */
  creatorHandle?: string | null
  creatorAvatar?: string | null
  creatorSales?: string | null
  thumbnail: string | null
  video: string | null
  /** Every video link TRYBE sent for this entry, the most likely whole
   *  video first, with where it was (Seb, 2026-10-24: "when i click on
   *  watch example i can always only see the first 3 seconds"). */
  videos?: Array<{ url: string; from: string }>
  /** Seconds, when TRYBE says. */
  seconds: number | null
}

// A VIDEO FILE WHEREVER TRYBE PUTS IT. The names above are guesses from
// TRYBE's page code, and a collection where all 100 came back without a file
// (Seb, 2026-10-18) means at least one guess is wrong. So when they miss, the
// entry is searched a few levels down for a link that is plainly a video file
// (by its ending) or sits under a name only a video file would have. A page
// link (a TikTok post, a creator's profile) is never taken: it is not a file
// anything can listen to.
const VIDEO_FILE = /\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i
const VIDEO_KEY = /^(video|videoUrl|video_url|videoFile|videoFileUrl|playbackUrl|playback_url|mediaUrl|media_url|fileUrl|file_url|downloadUrl|download_url|src|source|hlsUrl|mp4Url|rawVideoUrl|originalUrl)$/i
const PAGE_HOST = /^https:\/\/(www\.)?(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|trybe\.one)\//i
function findVideoFile(o: unknown, depth = 0): string | null {
  if (depth > 3) return null
  if (Array.isArray(o)) { for (const v of o.slice(0, 10)) { const f = findVideoFile(v, depth + 1); if (f) return f } return null }
  if (!isObj(o)) return null
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string' || !/^https:\/\//i.test(v) || PAGE_HOST.test(v)) continue
    if (VIDEO_FILE.test(v) || (VIDEO_KEY.test(k) && !/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v))) return v
  }
  for (const v of Object.values(o)) { if (typeof v === 'object') { const f = findVideoFile(v, depth + 1); if (f) return f } }
  return null
}

// THE WHOLE VIDEO BEFORE A CLIP. An entry can carry more than one video link:
// the one MVP took first played only the opening seconds, so every link is
// collected with the name it sat under, and one whose name says a short cut
// (preview, hook, clip, trim) goes after one that says the whole file.
const SHORT_CUT = /preview|hook|clip|trim|teaser|snippet|short|gif|sample|thumb|first|intro|loop|cover/i
const WHOLE = /full|original|raw|source|master|download|playback|hls|m3u8|submission|^video$|^videoUrl$|^url$/i
export function videoLinks(o: unknown, path = '', depth = 0, out: Array<{ url: string; from: string }> = []): Array<{ url: string; from: string }> {
  if (depth > 3 || out.length >= 8) return out
  if (Array.isArray(o)) { o.slice(0, 10).forEach((v, i) => videoLinks(v, `${path}[${i}]`, depth + 1, out)); return out }
  if (!isObj(o)) return out
  for (const [k, v] of Object.entries(o)) {
    const at = path ? `${path}.${k}` : k
    if (typeof v === 'string') {
      if (!/^https:\/\//i.test(v) || PAGE_HOST.test(v) || /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v)) continue
      if ((VIDEO_FILE.test(v) || VIDEO_KEY.test(k) || /video/i.test(k)) && !out.some((x) => x.url === v)) out.push({ url: v, from: at })
    } else if (typeof v === 'object') videoLinks(v, at, depth + 1, out)
  }
  return out
}
/** Whole files first, short cuts last, else as TRYBE sent them. Pure. */
export function rankVideoLinks(links: Array<{ url: string; from: string }>): Array<{ url: string; from: string }> {
  const score = (x: { from: string }) => { const k = x.from.split('.').pop() || x.from; return (SHORT_CUT.test(x.from) ? -2 : 0) + (WHOLE.test(k) ? 1 : 0) }
  return links.map((x, i) => ({ x, i })).sort((a, b) => score(b.x) - score(a.x) || a.i - b.i).map((a) => a.x)
}

/** The field names on TRYBE's first Top 100 entry, nested ones as
 *  `media.{url, type}`, for the team when no video file could be found in
 *  any of them. Says what TRYBE sent rather than that nothing was there. Pure. */
export function topEntryFields(json: unknown): string {
  const root = isObj(json) && (isObj(json.data) || Array.isArray(json.data)) ? json.data : json
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.creatives, root.topCreatives, root.videos, root.submissions, root.data].find(Array.isArray) as unknown[] | undefined) || [] : []
  const e = list.find(isObj)
  if (!e) return '(no entries)'
  return Object.entries(e).slice(0, 30).map(([k, v]) => {
    const inner = isObj(v) ? v : Array.isArray(v) && isObj(v[0]) ? v[0] : null
    return inner ? `${k}${Array.isArray(v) ? '[]' : ''}.{${Object.keys(inner).slice(0, 10).join(', ')}}` : k
  }).join(', ')
}

/** GET /backend/api/creator/v2/top-creatives, every field MVP can use. A
 *  field TRYBE does not send stays null. Pure. */
export function readTopEntries(json: unknown): TopVideoEntry[] {
  const root = isObj(json) && (isObj(json.data) || Array.isArray(json.data)) ? json.data : json
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.creatives, root.topCreatives, root.videos, root.submissions, root.data].find(Array.isArray) as unknown[] | undefined) || [] : []
  const out: TopVideoEntry[] = []
  list.forEach((raw, i) => {
    if (!isObj(raw)) return
    const brand = isObj(raw.brand) ? raw.brand : isObj(raw.brandProfile) ? raw.brandProfile : {}
    const meta = isObj(raw.metadata) ? raw.metadata : isObj(raw.media) ? raw.media : {}
    const creator = isObj(raw.creator) ? raw.creator : isObj(raw.creatorProfile) ? raw.creatorProfile : {}
    const brandName = str(first(raw, ['brandName', 'brand_name']) ?? first(brand, ['name', 'brandName'])) || null
    const brandId = str(first(raw, ['brandId', 'brand_id']) ?? first(brand, ['id', 'brandId'])) || null
    if (!brandId && !brandName) return
    const rank = num(first(raw, ['rank', 'position']))
    const secs = num(first(raw, ['durationSeconds', 'duration_seconds', 'duration', 'videoDuration', 'length']) ?? first(meta, ['durationSeconds', 'duration', 'videoDuration', 'length']))
    const url = (v: unknown) => { const s = str(v); return /^https:\/\//i.test(s) ? s : null }
    const cats = first(raw, ['category', 'categoryName', 'category_name']) ?? first(brand, ['category', 'primaryCategory'])
    out.push({
      id: str(first(raw, ['submissionId', 'submission_id', 'id'])) || null,
      rank: rank != null && rank > 0 ? rank : i + 1,
      brandId, brandName,
      brandLogo: url(first(brand, ['logo', 'logoUrl', 'logo_url', 'image', 'profileImage'])),
      category: (Array.isArray(cats) ? str(cats[0]) : str(isObj(cats) ? cats.name : cats)) || null,
      creator: str(first(raw, ['creatorName', 'creator_name']) ?? first(creator, ['name', 'displayName', 'username', 'handle'])) || null,
      creatorHandle: str(first(raw, ['creatorHandle', 'creator_handle', 'creatorUsername']) ?? first(creator, ['handle', 'username', 'tiktokHandle', 'instagramHandle'])).replace(/^@/, '') || null,
      creatorAvatar: url(first(raw, ['creatorAvatarUrl', 'creatorImageUrl']) ?? first(creator, ['avatarUrl', 'avatar', 'profileImageUrl', 'profilePictureUrl', 'imageUrl', 'photoUrl', 'image'])),
      creatorSales: str(first(raw, ['creatorGmvBucket', 'creatorSalesBucket', 'gmvBucket']) ?? first(creator, ['gmvBucket', 'gmv30dBucket', 'salesBucket', 'gmvRange', 'estimatedGmvBucket', 'gmvLabel'])).slice(0, 40) || null,
      thumbnail: url(first(raw, ['thumbnailUrl', 'thumbnail_url', 'thumbnail', 'coverUrl', 'posterUrl']) ?? first(meta, ['thumbnailUrl', 'thumbnail', 'coverUrl', 'posterUrl'])),
      ...(() => {
        const links = rankVideoLinks(videoLinks(raw))
        const named = url(first(raw, ['videoUrl', 'video_url', 'url', 'mediaUrl']) ?? first(meta, ['videoUrl', 'url', 'playbackUrl'])) ?? findVideoFile(raw)
        return { video: links[0]?.url ?? named, videos: links.length ? links : named ? [{ url: named, from: 'video' }] : [] }
      })(),
      // Milliseconds when large.
      seconds: secs != null && secs > 0 ? (secs > 1000 ? Math.round(secs / 1000) : Math.round(secs)) : null,
    })
  })
  return out
}

// ── How the openings start ───────────────────────────────────────────────────

export type HookType = 'viewer' | 'story' | 'number' | 'question' | 'claim' | 'other'

export const HOOK_TYPES: Array<{ type: HookType; label: string; says: string; color: string }> = [
  { type: 'viewer', label: 'Speak to the viewer', says: 'says "you" or "your" in the opening line', color: '#7C3AED' },
  { type: 'story', label: 'Open with your own story', says: 'starts with I, I’m or my', color: '#0E7490' },
  { type: 'number', label: 'Lead with a number', says: 'a figure or price in the opening line', color: '#DB2777' },
  { type: 'question', label: 'Ask a question', says: 'the opening line is a question', color: '#16A34A' },
  { type: 'claim', label: 'Make a flat claim', says: 'uses only, never, always, best or actually', color: '#D97706' },
]

/** The first sentence of a video's words. Pure. */
export function openingLine(words: string): string {
  const t = String(words || '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.{8,160}?[.!?])(\s|$)/)
  return (m ? m[1] : t.slice(0, 140)).trim()
}

/** Which kind of opening a line is, the first that fits in this order: a
 *  question, a number, the viewer, your own story, a flat claim. Pure. */
export function hookType(line: string): HookType {
  const l = ` ${String(line || '').toLowerCase()} `
  if (/\?\s*$/.test(line.trim())) return 'question'
  if (/\d|\$|\b(one|two|three|four|five|ten|hundred|thousand|half)\b/.test(l)) return 'number'
  if (/\b(you|your|you're|youre|you've|yours)\b/.test(l)) return 'viewer'
  if (/^(i|i'm|im|i've|ive|my|me)\b/.test(String(line || '').trim().toLowerCase().replace(/^["'“]+/, ''))) return 'story'
  if (/\b(only|never|always|best|actually|worst|every)\b/.test(l)) return 'claim'
  return 'other'
}

export interface HookCount { type: HookType; n: number; of: number; share: number }

/** How many openings of each kind, most common first. Pure. */
export function hookCounts(lines: string[]): HookCount[] {
  const of = lines.length
  const counts = new Map<HookType, number>()
  for (const l of lines) { const t = hookType(l); counts.set(t, (counts.get(t) || 0) + 1) }
  return HOOK_TYPES.map((h) => ({ type: h.type, n: counts.get(h.type) || 0, of, share: of ? (counts.get(h.type) || 0) / of : 0 }))
    .sort((a, b) => b.n - a.n)
}

/** Where the middle half of the lengths lands, in seconds; null under 4. */
export function middleHalf(seconds: number[]): { low: number; high: number; n: number } | null {
  const s = seconds.filter((x) => x > 0).sort((a, b) => a - b)
  if (s.length < 4) return null
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  return { low: q(0.25), high: q(0.75), n: s.length }
}
