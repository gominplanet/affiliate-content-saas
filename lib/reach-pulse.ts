// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pulse — the performance-learning collector.
 *
 * Every Reel/Short MVP publishes drops a `pending` row in `reach_samples` with
 * the hashtags it used and the product niche. A daily job (cron/collect-reach)
 * pulls each post's Instagram insights a day or so later, fills the numbers, and
 * computes `lift` (reach ÷ the account's own median reach). Tag performance is
 * then ranked per-user AND pooled across all users, sliced by niche — the
 * network effect that lets a brand-new creator get proven tags on day one.
 *
 * This file is the WRITE side (capture). Nothing here ever throws into the
 * publish path: a telemetry write must never break a real post.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { extractHashtags, detectNiche } from '@/lib/hashtag-map'

export interface RecordReachInput {
  userId: string
  /** The published Instagram media id — the key the insights job pulls stats for. */
  mediaId?: string | null
  /** The full caption, or the hashtags directly. Tags are parsed from the caption. */
  caption?: string | null
  hashtags?: string[] | null
  /** Product context (title/description) to derive the niche, when the caller has it. */
  productText?: string | null
  /** Explicit niche key if the caller already knows it (overrides productText). */
  niche?: string | null
  platform?: string
  /** The post's address, for the screen. */
  postUrl?: string | null
}

/** EVERY PLATFORM IS TRACKED (Seb, 2026-10-16: "track the hashtags for every
 *  platform"): the tags of every post are recorded. Results come back where
 *  the platform shares them with MVP's connection (Instagram, YouTube,
 *  Facebook, Pinterest, Bluesky: cron/collect-reach); elsewhere the row is
 *  'recorded' and says why, so a platform with no results never reads as a
 *  platform whose tags did nothing. */
export const NO_RESULTS_WHY: Record<string, string> = {
  tiktok: 'TikTok shares post results only with its video.list permission, which MVP\u2019s TikTok connection does not ask for yet.',
  threads: 'Threads shares post results only with its insights permission, which MVP\u2019s Threads connection does not ask for yet.',
  x: 'X shares post results only on its paid API plans.',
  linkedin: 'LinkedIn shares post results only with approved partner apps.',
  telegram: 'Telegram does not share channel post views with bots.',
}
export const RESULTS_FROM = new Set(['instagram', 'youtube', 'facebook', 'pinterest', 'bluesky'])
/** What a post's result is on each platform that shares one (cron/collect-reach). */
export const MEASURED_BY: Record<string, string> = {
  instagram: 'reach',
  youtube: 'views',
  facebook: 'reactions, comments and shares',
  pinterest: 'impressions',
  bluesky: 'likes, reposts and replies',
}
/** Every platform MVP posts to, in the order Pulse shows them. */
export const PULSE_PLATFORMS: Array<{ key: string; label: string }> = [
  { key: 'instagram', label: 'Instagram' }, { key: 'tiktok', label: 'TikTok' }, { key: 'youtube', label: 'YouTube' },
  { key: 'facebook', label: 'Facebook' }, { key: 'pinterest', label: 'Pinterest' }, { key: 'threads', label: 'Threads' },
  { key: 'x', label: 'X' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'bluesky', label: 'Bluesky' }, { key: 'telegram', label: 'Telegram' },
]

/** One published post, any platform, for Pulse. Never throws. */
export async function trackPost(input: { userId: string; platform: string; postId?: string | null; caption?: string | null; hashtags?: string[] | null; productText?: string | null; postUrl?: string | null }): Promise<void> {
  await recordReachSample({ userId: input.userId, platform: input.platform, mediaId: input.postId, caption: input.caption, hashtags: input.hashtags, productText: input.productText, postUrl: input.postUrl })
}

/**
 * Record a published post as a pending reach sample. Best-effort and fully
 * swallowed — a failure here is logged, never surfaced, and never blocks the
 * post. Skips silently when there's nothing worth learning from (no tags).
 */
export async function recordReachSample(input: RecordReachInput): Promise<void> {
  try {
    if (!input.userId) return
    const hashtags = (input.hashtags && input.hashtags.length
      ? input.hashtags
      : extractHashtags(input.caption || ''))
      .map(t => t.toLowerCase())
      // Hashtags only: not the disclosure, not a YouTube keyword phrase.
      .filter(t => t && t !== '#ad' && t !== '#sponsored' && !/\s/.test(t))
    // Nothing to attribute reach to → not worth a row.
    if (hashtags.length === 0) return

    const niche = (input.niche || detectNiche(input.productText || input.caption || '')) ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const platform = input.platform || 'instagram'
    // Results come back only where the platform shares them, and only for a
    // post MVP has the id of; otherwise 'recorded', with why.
    const collectable = RESULTS_FROM.has(platform) && !!input.mediaId
    const note = collectable ? null : (NO_RESULTS_WHY[platform] || (input.mediaId ? null : 'MVP did not get this post\u2019s id back, so its results cannot be read.'))
    const row = {
      user_id: input.userId,
      platform,
      media_id: input.mediaId || null,
      niche,
      hashtags,
      status: collectable ? 'pending' : 'recorded',
    }
    let { error } = await admin.from('reach_samples').insert({ ...row, note, post_url: input.postUrl || null })
    // Before migration 434 there is no note or post_url: saved without them.
    if (error && /note|post_url|column|schema cache/i.test(error.message)) ({ error } = await admin.from('reach_samples').insert(row))
    if (error) console.warn('[pulse] recordReachSample failed:', error.message)
  } catch (e) {
    console.warn('[pulse] recordReachSample threw:', e instanceof Error ? e.message : String(e))
  }
}
