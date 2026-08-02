// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Creator Connections access gate — shared by the CC data routes.
 *
 * CC is NOT a paid-tier feature. It's access-gated by PROOF the creator actually
 * has Creator Connections: SCOUT confirms their own CC grid renders and stamps
 * `integrations.cc_verified_at`. Any tier that's verified can browse the shared
 * catalog; an unverified user gets a `needsCcVerify` prompt regardless of plan.
 * (Content generation from a campaign stays paid — that's the content engine,
 * gated separately on /api/campaigns/generate.)
 */

// Keep in step with VERIFY_TTL_DAYS in /api/campaigns/cc-verify.
const CC_VERIFY_TTL_MS = 180 * 86_400_000

/** True when a cc_verified_at stamp exists and is still within the TTL window. */
export function ccVerifyFresh(ts: string | null | undefined): boolean {
  if (!ts) return false
  const age = Date.now() - new Date(ts).getTime()
  return Number.isFinite(age) && age >= 0 && age < CC_VERIFY_TTL_MS
}

/**
 * Whether this user may access the shared CC catalog. Admin (the operator) is
 * exempt. If the cc_verified_at column doesn't exist yet (migration not applied),
 * FAIL OPEN — don't lock everyone out of a stamp they can't write.
 * Returns { ok } so callers can return their own needsCcVerify shape.
 */
export async function ccAccessOk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  tier: string,
): Promise<boolean> {
  if (tier === 'admin') return true
  const { data, error } = await supabase
    .from('integrations').select('cc_verified_at').eq('user_id', userId).maybeSingle()
  const columnMissing = !!error && /column|does not exist|schema cache/i.test(error.message || '')
  if (columnMissing) return true
  return ccVerifyFresh(data?.cc_verified_at)
}
