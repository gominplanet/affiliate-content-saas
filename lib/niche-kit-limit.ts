// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIVE NEW NICHE GROUP KITS A MONTH. Each niche Group kit is its own write (and
// its own cover and icon), and a creator could make one for every niche they
// could type. Seb, 2026-10-05: "we can help with five a month. Anything else
// they can do manually, of course."
//
// Counted per user (every site together), per calendar month in UTC, from a
// zero-cost row written when a kit is actually made, so deleting a kit does not
// give the slot back. Kits already made stay on the page to use anytime. Admin
// is not limited.

import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'

export const NICHE_KITS_PER_MONTH = 5
export const NICHE_KIT_FEATURE = 'launch_kit_niche'

/** Start of the current calendar month in UTC. Pure. */
export function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export interface NicheKitUsage { used: number; limit: number; left: number }

/** How many niche Group kits this user made this month. Fails open (0). */
export async function nicheKitUsage(userId: string): Promise<NicheKitUsage> {
  let used = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (createAdminClient() as any).from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', NICHE_KIT_FEATURE)
      .gte('created_at', utcMonthStart().toISOString())
    used = count ?? 0
  } catch { /* a counting hiccup never blocks */ }
  return { used, limit: NICHE_KITS_PER_MONTH, left: Math.max(0, NICHE_KITS_PER_MONTH - used) }
}

export function nicheKitLimitMessage(): string {
  return `You've made ${NICHE_KITS_PER_MONTH} niche Group kits this month, the most MVP writes in a month. Your kits are all still here, and you can set up another Group by hand anytime. New kits are available again on the 1st.`
}

export function recordNicheKit(userId: string, tier: string | null): void {
  recordUsage({ userId, tier, feature: NICHE_KIT_FEATURE, model: 'counter', images: 0 })
}
