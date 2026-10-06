/**
 * Per-account monthly AI-spend circuit breaker.
 *
 * Sums the real AI cost (from the `ai_usage` telemetry table) an account has
 * burned in the CURRENT calendar month and compares it against the tier's
 * `monthlyAiSpendCeilingUsd`. When the account is over the ceiling, expensive
 * generation is paused with an upgrade nudge.
 *
 * This sits ON TOP of the per-feature monthly caps (postsPerMonth etc.) as a
 * hard dollar backstop — it catches:
 *   - a runaway loop / unattended "generate all" left running overnight,
 *   - uncapped internal/admin testing accounts (postsPerMonth: null), which is
 *     exactly what produced the overnight-$60 spike.
 *
 * Reads use the service-role client so RLS never hides a user's own rows from
 * the sum. The ceiling check is best-effort: if the lookup throws, we FAIL
 * OPEN (allow generation) — a telemetry hiccup must never hard-block a paying
 * user. The breaker only ever trips on a confident over-ceiling read.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { costOf, type UsageRow } from '@/lib/ai-usage'
import { TIERS, normalizeTier, type Tier } from '@/lib/tier'
import { freeTrialWindow, freeTrialExpiredBlock, FREE_TRIAL_OVER_MESSAGE } from '@/lib/free-trial'
import { accountSignupISO } from '@/lib/free-trial-signup'

/** First instant of the current calendar month, UTC, as an ISO string. */
function startOfMonthUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** First instant of the current UTC day, as an ISO string. */
function startOfDayUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/**
 * Platform-wide AI spend for the current UTC day, in USD. This is the global
 * backstop: the per-user ceiling can't stop a coordinated flood of free-trial
 * signups (1,000 trials × $5 = $5,000) from running up an aggregate bill, so
 * spendGate also checks this when GLOBAL_DAILY_SPEND_CEILING_USD is set.
 *
 * Uses the DB-side admin_ai_cost_rollup RPC (migration 129) — a GROUP BY that
 * returns a few rows priced in TS, NOT a full-table scan. Cached in-process for
 * 60s so concurrent generations don't each re-run the platform-wide sum.
 * Returns 0 on any error (fail-open). Reads cross-user totals → service-role.
 */
let globalSpendCache: { at: number; usd: number } | null = null
const GLOBAL_SPEND_CACHE_MS = 60_000
export async function globalDailySpendUsd(): Promise<number> {
  const now = Date.now()
  if (globalSpendCache && now - globalSpendCache.at < GLOBAL_SPEND_CACHE_MS) {
    return globalSpendCache.usd
  }
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .rpc('admin_ai_cost_rollup', { p_since: startOfDayUtcIso() })
    if (error || !Array.isArray(data)) return 0
    let total = 0
    for (const r of data as UsageRow[]) total += costOf(r)
    globalSpendCache = { at: now, usd: total }
    return total
  } catch {
    return 0 // fail-open: a telemetry hiccup must never hard-block generation
  }
}

/** The platform-wide daily ceiling in USD, or null if unset (guard disabled). */
export function globalDailyCeilingUsd(): number | null {
  const raw = Number(process.env.GLOBAL_DAILY_SPEND_CEILING_USD || '')
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * Total USD of AI cost this account has incurred since the start of the
 * current calendar month. Returns 0 on any error (fail-open).
 */
export async function monthlyAiSpendUsd(userId: string, sinceISO?: string): Promise<number> {
  if (!userId) return 0
  const since = sinceISO || startOfMonthUtcIso()
  try {
    const admin = createAdminClient()

    // Fast path: the DB groups this month's rows by model (≤~20 rows back) and
    // we price the grouped token sums in TS. Cost is linear per model, so this
    // is exact parity with per-row pricing — but it never ships thousands of
    // ai_usage rows over the wire on the hot generation path. See migration 134.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: grouped, error: rpcErr } = await (admin as any)
      .rpc('user_ai_cost_rollup', { p_user: userId, p_since: since })
    if (!rpcErr && Array.isArray(grouped)) {
      let total = 0
      for (const r of grouped as UsageRow[]) total += costOf(r)
      return total
    }

    // Fallback for a pre-migration-134 DB (RPC missing): the original row scan.
    const { data, error } = await admin
      .from('ai_usage')
      .select('model, input_tokens, output_tokens, web_searches, images')
      .eq('user_id', userId)
      .gte('created_at', since)
    if (error || !data) return 0
    let total = 0
    for (const r of data as UsageRow[]) total += costOf(r)
    return total
  } catch {
    return 0 // fail-open: never hard-block on a telemetry read failure
  }
}

export interface SpendStatus {
  /** USD spent this calendar month. */
  spent: number
  /** Tier ceiling in USD, or null if the tier has no ceiling. */
  ceiling: number | null
  /** True when spent >= ceiling (and a ceiling exists). */
  exceeded: boolean
  /** Fraction 0–1 of the ceiling used (0 when no ceiling). */
  fraction: number
  tier: Tier
  /** True when a free account's trial window has closed. Counts as exceeded:
   *  an expired trial gets no more free AI from any gated route. */
  trialOver: boolean
}

/** The tier's monthly AI-spend ceiling, or null if uncapped. */
export function ceilingForTier(tier: unknown): number | null {
  const t = normalizeTier(tier)
  const c = (TIERS[t] as { monthlyAiSpendCeilingUsd?: number | null }).monthlyAiSpendCeilingUsd
  return typeof c === 'number' ? c : null
}

/**
 * Full spend status for an account — used both by the gate (server-side
 * generation routes) and by the billing-page meter. Single round-trip.
 */
export async function spendStatus(userId: string, tier: unknown): Promise<SpendStatus> {
  const t = normalizeTier(tier)
  const ceiling = ceilingForTier(t)

  // THE FREE TRIAL IS ONE WINDOW, NOT A MONTH. Two leaks lived here while the
  // trial ceiling was summed per calendar month and nothing but the thumbnail,
  // photobooth and face routes asked whether the trial had ended:
  //   - a trial that spans the 1st got its $15 twice, and
  //   - an EXPIRED trial kept every text route (captions, scripts, the
  //     assistant, pin copy...) at $15 a month for as long as the account
  //     existed, which with a paid video ad buying signups is the leak that
  //     scales with every abandoned account.
  // So a trial sums its spend from signup, and an expired trial is exceeded.
  // An unreadable signup date keeps the calendar month and never expires, as
  // freeTrialWindow promises: a lookup failure must not lock an account.
  let since: string | undefined
  let trialOver = false
  if (t === 'trial') {
    const signupISO = await accountSignupISO(userId)
    if (signupISO) {
      since = freeTrialWindow(signupISO).startISO
      trialOver = freeTrialExpiredBlock({ tier: t, signupISO }) != null
    }
  }

  const spent = await monthlyAiSpendUsd(userId, since)
  const exceeded = trialOver || (ceiling != null && spent >= ceiling)
  const fraction = trialOver ? 1 : ceiling != null && ceiling > 0 ? Math.min(1, spent / ceiling) : 0
  return { spent, ceiling, exceeded, fraction, tier: t, trialOver }
}

/**
 * Gate helper for generation routes. Returns `{ allowed: false, ... }` only
 * when the account is confidently over its ceiling; otherwise allows.
 * Fails open on any error (monthlyAiSpendUsd already returns 0 on failure).
 */
export async function checkSpendCeiling(
  userId: string,
  tier: unknown,
): Promise<{ allowed: boolean; status: SpendStatus }> {
  const status = await spendStatus(userId, tier)
  return { allowed: !status.exceeded, status }
}

/**
 * Which plan the spend pause offers. ONLY THE TWO PLANS ON SALE: the blog
 * ladder in nextTierFor sent a free account nowhere ("contact support") and a
 * legacy Creator account to Studio, a plan nobody can buy. Free goes to Amazon,
 * everything below Pro goes to Pro, Pro and admin have nowhere to go.
 */
export function spendUpgradeFor(tier: unknown): { tier: Tier; label: string; limit: number | null } | null {
  const t = normalizeTier(tier)
  if (t === 'pro' || t === 'admin') return null
  const to: Tier = t === 'trial' ? 'amazon' : 'pro'
  // limit stays null: the ceiling is dollars, and dollars never reach the user.
  return { tier: to, label: TIERS[to].label, limit: null }
}

/**
 * Drop-in gate for any expensive generation route. Returns a ready-to-return
 * 403 NextResponse when the account is over its monthly AI-spend ceiling, or
 * `null` to proceed. Usage at the top of a POST handler, right after the tier
 * is known:
 *
 *   const gate = await spendGate(userId, tier)
 *   if (gate) return gate
 *
 * Fails open (returns null) on any telemetry error — never hard-blocks on a
 * read failure. Keep the gate AFTER auth but BEFORE the model call.
 */
export async function spendGate(userId: string, tier: unknown): Promise<NextResponse | null> {
  if (!userId) return null

  // Platform-wide daily backstop (off unless GLOBAL_DAILY_SPEND_CEILING_USD is
  // set). Catches a coordinated trial-signup flood that the per-user ceiling
  // can't — admins are exempt so the operator can still work past a paused day.
  const globalCeiling = globalDailyCeilingUsd()
  if (globalCeiling != null && normalizeTier(tier) !== 'admin') {
    const globalSpent = await globalDailySpendUsd()
    if (globalSpent >= globalCeiling) {
      return NextResponse.json({
        error: 'Generation is paused for a short while due to unusually high platform-wide demand. Please try again later. Your usage limits are unaffected.',
        limitReached: true,
        cap: 'global',
      }, { status: 503 })
    }
  }

  const status = await spendStatus(userId, tier)
  if (!status.exceeded) return null
  const next = spendUpgradeFor(status.tier)
  // NEVER surface the underlying AI cost/ceiling to the user — no dollars, no
  // "AI usage", no spend object. Keep the pause message about generation only.
  // A TRIAL NEVER "RESETS ON THE 1ST": its window is one-off, so saying so
  // promised free AI that was never coming back.
  if (status.tier === 'trial') {
    return NextResponse.json({
      error: status.trialOver
        ? FREE_TRIAL_OVER_MESSAGE
        : `You have used the free AI on this trial. ${next ? `Upgrade to ${next.label} to keep making designs.` : 'Upgrade to keep making designs.'}`,
      limitReached: true,
      cap: status.trialOver ? 'trial' : 'spend',
      currentTier: status.tier,
      upgrade: next,
    }, { status: 403 })
  }
  return NextResponse.json({
    error:
      `Generation is paused on this account for now. It resets on the 1st. ` +
      `${next ? `Upgrade to ${next.label} for a higher monthly limit.` : 'Contact support if you need it raised sooner.'}`,
    limitReached: true,
    cap: 'spend',
    currentTier: status.tier,
    upgrade: next,
  }, { status: 403 })
}
