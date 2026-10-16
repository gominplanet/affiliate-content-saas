// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What the hashtag engine (lib/hashtag-engine) knows, loaded for one post:
// what lifted this creator's reach on this platform and what lifted other
// members' in the same niche (Pulse), and what is trending on this platform
// (hashtag_trends, migration 434: TikTok Creative Center read by SCOUT,
// YouTube's hashtag pages, Instagram's tag pages read by SCOUT).
//
// BEST EFFORT, NEVER IN THE WAY: each source has a short time limit and a
// failure is an empty list, so a caption is never held up or refused because
// a trend read or the database was slow. The pick then rests on the category
// map and the brand, and says so tag by tag.

import { createAdminClient } from '@/lib/supabase/admin'
import { personalTagStats, pooledTagStats } from '@/lib/pulse-rank'
import { detectNiche } from '@/lib/hashtag-map'
import { pickHashtags, withTags, withoutTags, writerTags, type TagInput, type TagPick, type TagPlatform, type TrendTag } from '@/lib/hashtag-engine'

/** The platform Pulse and the trends are kept under. */
export function pulsePlatform(p: TagPlatform): string {
  return p === 'youtube_short' ? 'youtube' : p === 'facebook_group' ? 'facebook' : p
}

/** Trends are read again after this long; older ones are not used. */
export const TREND_FRESH_DAYS = 10

const within = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/** Trending tags kept for this platform, freshest first. Empty before migration 434. */
export async function trendsFor(platform: TagPlatform, limit = 1000): Promise<TrendTag[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const since = new Date(Date.now() - TREND_FRESH_DAYS * 86_400_000).toISOString()
    const { data, error } = await admin.from('hashtag_trends')
      .select('tag, source, rank, posts, views, label')
      .eq('platform', pulsePlatform(platform)).gte('seen_at', since)
      .order('seen_at', { ascending: false }).limit(limit)
    if (error) return []
    return ((data || []) as Array<{ tag: string; source: string; rank: number | null; posts: number | null; views: number | null; label: string | null }>)
      .map((r) => ({ tag: r.tag, source: r.source, rank: r.rank, posts: r.posts, views: r.views, label: r.label }))
  } catch { return [] }
}

/** Pick one post's hashtags with everything MVP knows. Never throws. */
export async function hashtagsFor(input: TagInput & { userId?: string | null }): Promise<TagPick> {
  const platform = pulsePlatform(input.platform)
  const niche = detectNiche(`${input.text || ''} ${(input.niches || []).join(' ')}`)
  const [yours, members, trends] = await Promise.all([
    input.yours ?? (input.userId ? within(personalTagStats(input.userId, 2, platform), 2500, []) : Promise.resolve([])),
    input.members ?? within(pooledTagStats(niche, 5, platform), 2500, []),
    input.trends ?? within(trendsFor(input.platform), 2500, []),
  ])
  return pickHashtags({ ...input, yours, members, trends })
}

/** Just the tags, for a caller that only needs the line. */
export async function hashtagLine(input: TagInput & { userId?: string | null }): Promise<string[]> {
  return (await hashtagsFor(input)).tags.map((t) => t.tag)
}

/** What the engine knows, loaded ONCE for several posts at a time (a plan of
 *  clips that go to TikTok, Reels and Shorts): the creator's Pulse and the
 *  niche's pooled results across all platforms, and the trends of every
 *  platform named, together. Never throws; a slow source is empty. */
export async function tagData(opts: { platforms: TagPlatform[]; userId?: string | null; text: string; niches?: string[] }): Promise<Pick<TagInput, 'yours' | 'members' | 'trends'>> {
  const niche = detectNiche(`${opts.text || ''} ${(opts.niches || []).join(' ')}`)
  const [yours, members, ...trendLists] = await Promise.all([
    opts.userId ? within(personalTagStats(opts.userId, 2, null), 2500, []) : Promise.resolve([]),
    within(pooledTagStats(niche, 5, null), 2500, []),
    ...Array.from(new Set(opts.platforms)).map((p) => within(trendsFor(p), 2500, [] as TrendTag[])),
  ])
  return { yours, members, trends: trendLists.flat() }
}

/** A finished post with its hashtags PICKED BY THE ENGINE, from the research
 *  (Pulse, trends, the platform's counts), the writer's own tags kept as
 *  candidates. Used where a model writes the post (Threads, X, LinkedIn,
 *  Bluesky, Telegram), which used to post the writer's guess, cleaned up.
 *  The tags go on the last line, dropped from the end to fit maxChars. Never
 *  throws: on any failure the post goes as written, and the safety net
 *  (fitHashtags) still runs when it is sent. */
export async function researchedTags(text: string, input: { platform: TagPlatform; about: string; brand?: string | null; userId?: string | null; maxChars?: number | null; niches?: string[] }): Promise<{ text: string; pick: TagPick | null }> {
  try {
    const pick = await hashtagsFor({ platform: input.platform, text: `${input.about || ''}\n${withoutTags(text)}`, brand: input.brand ?? null, writer: writerTags(text), niches: input.niches, userId: input.userId })
    if (!pick.tags.length) return { text, pick }
    return { text: withTags(text, pick.tags.map((t) => t.tag), { maxChars: input.maxChars ?? null }), pick }
  } catch {
    return { text, pick: null }
  }
}
