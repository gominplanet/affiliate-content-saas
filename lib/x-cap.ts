/**
 * X (Twitter) monthly post cap — the ONE social channel with a real cost to us,
 * so it's the only one we meter.
 *
 * X bills per REQUEST, not per successful post. Confirmed against the developer
 * console (2026-09-14): 227 requests over 30 days against $45.41 of cost, which
 * is $0.2000 each. Note that the console's "Billable events" tile reads 0 over
 * the same window, so that tile is not the meter that produces the invoice —
 * the Requests chart is. A failed createTweet is a request and is charged.
 *
 * X is Pro-only (see lib/tier.ts socials). This bounds a single Pro account to
 * X_MONTHLY_CAP posts per billing period (~$20 of X spend, and more than that
 * if their posts are failing), stopping one user or a runaway loop from
 * draining the shared X credit balance. Admin = unlimited.
 *
 * Counts `x_post` rows in ai_usage within the user's billing window — same
 * telemetry-as-counter approach as checkUsageCap, no parallel table to sync.
 * Every X post path reserves ONE `x_post` row up front; a failure re-labels it
 * to 'x_post_failed' (see refundXPost) so the slot comes back but the money we
 * actually spent does not disappear from the books.
 */
import { normalizeTier, billingWindow, type Tier } from '@/lib/tier'
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

export interface XReserveResult {
  tier: Tier
  resetLabel: string
  /** true = a slot is yours (published may proceed). false = over cap. */
  ok: boolean
  /** The reserved ai_usage row id; refund it (refundXPost) if the tweet fails.
   *  null when nothing was reserved (over cap, admin-unlimited, or a metering
   *  hiccup where we fail open). */
  reservationId: string | null
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

/**
 * Atomically reserve one X-post slot BEFORE calling createTweet. Replaces the old
 * check-then-record pair: the DB function checks the cap and inserts the counter
 * row under a per-user lock in one transaction, so concurrent posts in a single
 * cron tick can't all pass the check and overspend.
 *
 * On success keep the reservation (do NOT also call recordXPost — that would
 * double-count). If the tweet FAILS, call refundXPost(reservationId) so the
 * failed attempt doesn't burn a paid slot.
 *
 * Fails OPEN on a DB/RPC error (returns ok:true, reservationId:null) — a metering
 * hiccup must never block a scheduled post. The atomic lock still closes the real
 * concurrency overspend; a transient RPC error is rare and self-corrects.
 */
export async function reserveXPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<XReserveResult> {
  const { data } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId).maybeSingle()
  const tier = normalizeTier(data?.tier) as Tier
  const cap = tier === 'admin' ? null : X_MONTHLY_CAP
  const { startISO, resetLabel } = billingWindow({
    periodStart: (data?.subscription_period_start as string | null) ?? null,
    periodEnd: (data?.subscription_period_end as string | null) ?? null,
  })
  try {
    const { data: rid, error } = await supabase.rpc('claim_x_post', {
      p_user_id: userId, p_cap: cap, p_since: startISO, p_tier: tier,
    })
    if (error) {
      // Fail open — don't block a paid post on a metering hiccup.
      console.warn('[x-cap] claim_x_post RPC error, failing open:', error.message)
      return { ok: true, reservationId: null, tier, resetLabel }
    }
    if (!rid) return { ok: false, reservationId: null, tier, resetLabel } // over cap
    return { ok: true, reservationId: rid as string, tier, resetLabel }
  } catch (e) {
    console.warn('[x-cap] reserveXPost threw, failing open:', e instanceof Error ? e.message : e)
    return { ok: true, reservationId: null, tier, resetLabel }
  }
}

/**
 * Refund a reservation when the tweet failed, so it doesn't burn a slot.
 *
 * It does NOT delete the row, and that distinction is the whole point.
 *
 * X bills per REQUEST, not per successful post. The developer console's own
 * numbers say so: 227 requests over 30 days against $45.41 of cost, which is
 * $0.2000 each to four decimal places. A createTweet that comes back 4xx or
 * 5xx was still a request and was still charged.
 *
 * This used to `delete` the row, which refunded the user's slot AND erased the
 * money. Two different things were riding on one row: the cap counter (should
 * a failed post cost the creator one of their monthly slots? no) and the cost
 * record (did we pay X for it? yes). Deleting served the first and lied about
 * the second, so every failed X post vanished from cost reporting entirely.
 *
 * So the row is re-labelled instead. PRIMARY_FEATURE.x is ['x_post'], so
 * 'x_post_failed' is invisible to the cap and the creator keeps their slot,
 * while the $0.20 stays visible to the admin cost dashboard and to the monthly
 * spend circuit breaker. The breaker seeing it is deliberate: a loop that fails
 * five hundred times in a row is exactly the runaway the breaker exists to
 * catch, and a failure that costs nothing to the meter is a failure nobody
 * stops.
 *
 * If the re-label itself fails we fall back to leaving the row as 'x_post'.
 * That costs the creator a slot, which is the lesser wrong: the alternative is
 * losing the money from the books.
 */
export async function refundXPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reservationId: string | null | undefined,
): Promise<void> {
  if (!reservationId) return
  try {
    await supabase.from('ai_usage')
      .update({ feature: 'x_post_failed' })
      .eq('id', reservationId).eq('feature', 'x_post')
  } catch (e) {
    console.warn('[x-cap] refundXPost failed (slot stays reserved):', e instanceof Error ? e.message : e)
  }
}

/** Friendly over-cap message for a surfaced error. */
export function xCapMessage(resetLabel: string): string {
  return `You've used all ${X_MONTHLY_CAP} X posts for this billing period.${resetLabel ? ` Resets ${resetLabel}.` : ''}`
}
