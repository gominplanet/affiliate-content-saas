// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Cloned-voice dub credits. Standard dubs (OpenAI) are free + unlimited; the
// premium "sounds like you" lane (ElevenLabs cloned voice) spends one credit
// per geo dub. Each plan grants a monthly allowance that accumulates; the
// balance falls back to the standard voice when it hits zero, so dubbing never
// blocks. Admin is unlimited (null).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Monthly cloned-voice credit grant per tier. Pro is the only paid tier that
 *  can dub (the route gates to pro/admin). Tune here as plans evolve. */
export const PRO_DUB_CREDITS = 150

/** Credits granted per period for a tier, or null for unlimited (admin). */
export function dubCreditsForTier(tier: string): number | null {
  if (tier === 'admin') return null
  if (tier === 'pro') return PRO_DUB_CREDITS
  return 0
}

/** Period key for the grant. Uses the subscription period start date when
 *  present, else the calendar month, so the grant tops up once per period. */
export function dubPeriodKey(periodStart?: string | null): string {
  if (periodStart) return String(periodStart).slice(0, 10)
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Current cloned-voice credit balance (applies the period grant first). Returns
 *  null for unlimited (admin). */
export async function dubCreditBalance(sb: Sb, userId: string, tier: string, periodStart?: string | null): Promise<number | null> {
  const grant = dubCreditsForTier(tier)
  if (grant === null) return null
  try {
    const { data } = await sb.rpc('dub_credits_balance', { p_user: userId, p_period: dubPeriodKey(periodStart), p_grant: grant })
    return typeof data === 'number' ? data : 0
  } catch { return 0 }
}

/** Spend one cloned-voice credit. Returns { spent, balance }. Admin always
 *  spends (unlimited) with a null balance. */
export async function spendDubCredit(sb: Sb, userId: string, tier: string, periodStart?: string | null): Promise<{ spent: boolean; balance: number | null }> {
  const grant = dubCreditsForTier(tier)
  if (grant === null) return { spent: true, balance: null }
  try {
    const { data } = await sb.rpc('dub_credits_spend', { p_user: userId, p_period: dubPeriodKey(periodStart), p_grant: grant })
    const n = typeof data === 'number' ? data : -1
    return n >= 0 ? { spent: true, balance: n } : { spent: false, balance: 0 }
  } catch {
    // Fail-open would spend real ElevenLabs money without a credit; fail-closed
    // (standard voice) is the safe default on a ledger hiccup.
    return { spent: false, balance: 0 }
  }
}
