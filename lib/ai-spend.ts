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
import { TIERS, normalizeTier, nextTierFor, type Tier } from '@/lib/tier'

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
export async function monthlyAiSpendUsd(userId: string): Promise<number> {
  if (!userId) return 0
  const since = startOfMonthUtcIso()
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
  const spent = await monthlyAiSpendUsd(userId)
  const exceeded = ceiling != null && spent >= ceiling
  const fraction = ceiling != null && ceiling > 0 ? Math.min(1, spent / ceiling) : 0
  return { spent, ceiling, exceeded, fraction, tier: t }
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
        error: 'Generation is paused for a short while due to unusually high platform-wide demand. Please try again later — your usage limits are unaffected.',
        limitReached: true,
        cap: 'global',
      }, { status: 503 })
    }
  }

  const status = await spendStatus(userId, tier)
  if (!status.exceeded) return null
  const next = nextTierFor(status.tier, 'postsPerMonth')
  return NextResponse.json({
    error:
      `This account has reached its monthly AI usage limit ` +
      `($${status.ceiling?.toFixed(0)} of AI cost this month). ` +
      `Generation is paused until the 1st, or ` +
      `${next ? `upgrade to ${next.label} for a higher limit.` : 'contact support to raise the limit.'}`,
    limitReached: true,
    cap: 'spend',
    currentTier: status.tier,
    spend: { spent: Number(status.spent.toFixed(2)), ceiling: status.ceiling },
    upgrade: next,
  }, { status: 403 })
}
