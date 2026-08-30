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
  /** Thumbnail route runs exactly ONE primary path per generation —
   *  gpt-image-1 (face), Kontext (product), flux-lora (legacy face), or the
   *  Flux Pro fallback — so summing these feature names = total successful
   *  thumbnail generations. */
  thumbnail: ['yt_thumb_gptimage', 'yt_thumb_kontext_image', 'yt_thumb_flux_image', 'yt_thumb_flux_lora_image', 'yt_thumb_nanobanana_image', 'yt_thumb_ideogram_image'] as string[],
  /** Metadata 5-agent swarm; title_strategist runs exactly once per
   *  generation, so counting it = total successful metadata gens. */
  metadata: ['yt_meta_title_strategist'] as string[],
  /** Native Instagram AI image — Pro-only, separately capped from
   *  YouTube thumbnails (different surface, different aspect ratio). */
  instagramAi: ['ig_ai_thumbnail_image'] as string[],
  /** AI assistant — one row per user message turn. */
  assistant: ['assistant_message'] as string[],
  /** Photobooth headshot — one row per successful generation. */
  photobooth: ['photobooth_image'] as string[],
  /** Shop Burner "Make one from text" CTA box — one row per generation
   *  (the Nano Banana Pro render). Caps the only paid step in the burner. */
  ctaBox: ['cta_sticker_gen'] as string[],
  /** Clip Factory — one row per FINISHED Short (the render step). Counting it =
   *  total Shorts rendered this period. Planning / finding clips is free. */
  short: ['shorts_render'] as string[],
  /** X / Twitter — one row per successfully published tweet. X is the only
   *  channel with a real per-post cost to us ($0.20 on the Pay Per Use plan),
   *  so it's the only social with its own cap. Counting it = tweets this period. */
  x: ['x_post'] as string[],
  /** Storefront Sync dub — one row per finished per-market dub (the TTS step).
   *  Each dub's input is capped at ~5,000 characters, so at $0.10/1k the cost is
   *  bounded at ~$0.50 per dub; counting dubs therefore bounds our ElevenLabs
   *  exposure directly. */
  dub: ['global_sync_dub_tts'] as string[],
}

/** Per-market dubs a Pro user can generate per billing period (admin = unlimited).
 *  At ~$0.50 max per dub this bounds ElevenLabs exposure at ~$75 per Pro user per
 *  month. Tune here as pricing / plans evolve; power users beyond this need an
 *  overage add-on rather than a higher hard cap. */
export const DUB_MONTHLY_CAP = 150

/** Finished Shorts a Pro user can render per billing period (admin = unlimited). */
export const SHORTS_MONTHLY_CAP = 50

/** X posts a Pro user can publish per billing period (admin = unlimited). X is
 *  Pro-only, and each post costs us $0.20, so this bounds our exposure at ~$20
 *  per Pro user per month. */
export const X_MONTHLY_CAP = 100

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
