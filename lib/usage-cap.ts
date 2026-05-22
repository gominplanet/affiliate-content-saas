/**
 * Shared per-tier usage gating for high-cost AI actions that aren't
 * automatically gated by the postsPerMonth / collabsPerMonth caps
 * (thumbnails, metadata regenerations, …).
 *
 * Reads counts straight off the ai_usage telemetry table — one row per
 * billable call — so we don't need a parallel counter to keep in sync.
 *
 * Each high-level action has a "primary feature" name that appears
 * exactly once per generation in ai_usage; counting that feature
 * gives an accurate generations-this-period number even though the
 * generation itself fires multiple model calls.
 */
import { billingWindow } from '@/lib/tier'

/** Primary ai_usage.feature name that appears once per high-level
 *  generation event. Used as the counter for cap checks. */
export const PRIMARY_FEATURE = {
  /** Thumbnail route runs either the Kontext path OR the Flux Pro
   *  fallback — never both — so summing both feature names equals
   *  total successful thumbnail generations. */
  thumbnail: ['yt_thumb_kontext_image', 'yt_thumb_flux_image'] as string[],
  /** Metadata 5-agent swarm; title_strategist runs exactly once per
   *  generation, so counting it = total successful metadata gens. */
  metadata: ['yt_meta_title_strategist'] as string[],
  /** Native Instagram AI image — Pro-only, separately capped from
   *  YouTube thumbnails (different surface, different aspect ratio). */
  instagramAi: ['ig_ai_thumbnail_image'] as string[],
  /** AI assistant — one row per user message turn. */
  assistant: ['assistant_message'] as string[],
}

interface CapCheck {
  used: number
  limit: number | null
  exceeded: boolean
  resetLabel: string
}

/**
 * Count how many `features` calls a user has made in their current
 * billing period and compare against `limit`.
 *
 * Returns null on DB error — callers should treat that as "not over
 * cap" rather than blocking the user on a telemetry hiccup. Telemetry
 * must never break a paid action.
 */
export async function checkUsageCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  features: string[],
  limit: number | null,
  billingPeriodStart: string | null,
  billingPeriodEnd: string | null,
): Promise<CapCheck | null> {
  if (limit === null) {
    // null = unlimited (admin tier).
    return { used: 0, limit: null, exceeded: false, resetLabel: '' }
  }

  const { startISO, resetLabel } = billingWindow({
    periodStart: billingPeriodStart,
    periodEnd: billingPeriodEnd,
  })

  try {
    const { count } = await supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('feature', features)
      .gte('created_at', startISO)

    const used = count ?? 0
    return { used, limit, exceeded: used >= limit, resetLabel }
  } catch {
    return null
  }
}
