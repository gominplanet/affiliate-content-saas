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
      .filter(t => t && t !== '#ad')
    // Nothing to attribute reach to → not worth a row.
    if (hashtags.length === 0) return

    const niche = (input.niche || detectNiche(input.productText || input.caption || '')) ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin.from('reach_samples').insert({
      user_id: input.userId,
      platform: input.platform || 'instagram',
      media_id: input.mediaId || null,
      niche,
      hashtags,
      status: 'pending',
    })
    if (error) console.warn('[pulse] recordReachSample failed:', error.message)
  } catch (e) {
    console.warn('[pulse] recordReachSample threw:', e instanceof Error ? e.message : String(e))
  }
}
