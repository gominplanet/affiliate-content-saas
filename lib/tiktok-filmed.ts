// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRANDS A CREATOR FILMED, AS KEPT (Match my TikTok, migration 465): for
// Find brands' Filmed on TikTok chip and filter, and for the line a request to
// such a brand carries. Reads the matches kept on the creator's row only, so
// the TRYBE route never loads the matcher or its word list (lib/tiktok-match).

import { isMatch, type Sureness, type MatchKind } from './tiktok-match-words'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface Kept { brandId: string; sureness: Sureness; videoIds: string[]; how?: Array<{ kind: MatchKind; videoId: string }> }

/** The brand ids a creator filmed, sure and likely, for Find brands. */
export async function filmedBrandIds(admin: Db, userId: string): Promise<Map<string, { sureness: string; videos: number }>> {
  const out = new Map<string, { sureness: string; videos: number }>()
  const { data, error } = await admin.from('tiktok_library').select('matches').eq('user_id', userId).maybeSingle()
  if (error || !data) return out
  for (const m of (Array.isArray(data.matches) ? data.matches : []) as Kept[]) {
    if (m && m.brandId && isMatch(m)) out.set(m.brandId, { sureness: m.sureness, videos: (m.videoIds || []).length })
  }
  return out
}

/** For a request to a brand you filmed: the video to name, the strongest match
 *  first, and the product it shows when TikTok tagged one. */
export async function filmedVideos(admin: Db, userId: string, brandIds: string[]): Promise<Map<string, { url: string; product: string | null }>> {
  const out = new Map<string, { url: string; product: string | null }>()
  const { data, error } = await admin.from('tiktok_library').select('matches').eq('user_id', userId).maybeSingle()
  if (error || !data) return out
  const want = new Set(brandIds)
  const picks = new Map<string, string>()
  for (const m of (Array.isArray(data.matches) ? data.matches : []) as Kept[]) {
    if (!m || !want.has(m.brandId) || !isMatch(m)) continue
    const vid = m.how?.[0]?.videoId || m.videoIds?.[0]
    if (vid) picks.set(m.brandId, vid)
  }
  if (!picks.size) return out
  const { data: vids } = await admin.from('tiktok_videos').select('video_id, url, products').eq('user_id', userId).in('video_id', Array.from(new Set(picks.values())))
  const byId = new Map(((vids || []) as Array<{ video_id: string; url: string; products: unknown }>).map((v) => [v.video_id, v]))
  for (const [brandId, vid] of Array.from(picks.entries())) {
    const v = byId.get(vid)
    if (!v?.url) continue
    const tags = Array.isArray(v.products) ? (v.products as Array<{ title?: string | null }>) : []
    out.set(brandId, { url: v.url, product: tags.find((p) => p?.title)?.title ?? null })
  }
  return out
}
