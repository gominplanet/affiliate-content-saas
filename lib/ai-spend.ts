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
import { createAdminClient } from '@/lib/supabase/admin'
import { costOf, type UsageRow } from '@/lib/ai-usage'
import { TIERS, normalizeTier, type Tier } from '@/lib/tier'

/** First instant of the current calendar month, UTC, as an ISO string. */
function startOfMonthUtcIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/**
 * Total USD of AI cost this account has incurred since the start of the
 * current calendar month. Returns 0 on any error (fail-open).
 */
export async function monthlyAiSpendUsd(userId: string): Promise<number> {
  if (!userId) return 0
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('ai_usage')
      .select('model, input_tokens, output_tokens, web_searches, images')
      .eq('user_id', userId)
      .gte('created_at', startOfMonthUtcIso())
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
