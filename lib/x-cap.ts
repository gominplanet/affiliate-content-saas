/**
 * X (Twitter) monthly post cap — the ONE social channel with a real per-post
 * cost to us ($0.20 on X's Pay Per Use plan), so it's the only one we meter.
 *
 * X is Pro-only (see lib/tier.ts socials). This bounds a single Pro account to
 * X_MONTHLY_CAP posts per billing period (~$20 of X spend), stopping one user or
 * a runaway loop from draining the shared X credit balance. Admin = unlimited.
 *
 * Counts `x_post` rows in ai_usage within the user's billing window — same
 * telemetry-as-counter approach as checkUsageCap, no parallel table to sync.
 * Every X post path records ONE `x_post` row on success via recordXPost().
 */
import { normalizeTier, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE, X_MONTHLY_CAP } from '@/lib/usage-cap'
import { recordUsage } from '@/lib/ai-usage'

export { X_MONTHLY_CAP }

export interface XCapResult {
  tier: Tier
  used: number
  limit: number | null
  exceeded: boolean
  resetLabel: string
}

/**
 * Has this user hit their X post cap for the current billing period? Loads the
 * tier + billing window off `integrations`. On a telemetry error it returns
 * not-exceeded — a metering hiccup must never block a paid post.
 */
export async function checkXPostCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<XCapResult> {
  const { data } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId).maybeSingle()
  const tier = normalizeTier(data?.tier) as Tier
  const limit = tier === 'admin' ? null : X_MONTHLY_CAP
  const check = await checkUsageCap(
    supabase, userId, PRIMARY_FEATURE.x, limit,
    (data?.subscription_period_start as string | null) ?? null,
    (data?.subscription_period_end as string | null) ?? null,
  )
  return { tier, used: check?.used ?? 0, limit, exceeded: !!check?.exceeded, resetLabel: check?.resetLabel ?? '' }
}

/** Record one successful X post so the counter increments. Call AFTER createTweet succeeds. */
export function recordXPost(userId: string, tier: Tier | string | null | undefined): void {
  recordUsage({ userId, tier: tier ?? null, feature: 'x_post', model: 'twitter-api', images: 1 })
}

/** Friendly over-cap message for a surfaced error. */
export function xCapMessage(resetLabel: string): string {
  return `You've used all ${X_MONTHLY_CAP} X posts for this billing period.${resetLabel ? ` Resets ${resetLabel}.` : ''}`
}
