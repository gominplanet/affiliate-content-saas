// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MANY "FIND MOMENTS" SEARCHES. Each Clip Factory search pulls the video,
// transcribes it and runs the planner (up to about $0.20; a repeat on a video
// already transcribed is about $0.03), and it had no limit of its own.
//
//   New Pro members      60 a month, in their billing period. Seb, 2026-10-05:
//                        moving from 10 a day (up to 300 a month, $60 maxed)
//                        to 60 a month is what pays for keeping Pro at 100
//                        generations.
//   The Amazon plan      20 a month (lib/amazon-plan), since it got Clip
//                        Factory on 2026-10-05.
//   Pro members from     10 a day, the limit set the same morning, since they
//   before that day      keep their limits for good (migration 405 cohort).
//
// Counted once per search that found moments; "Post the whole video" is not a
// search and is not counted. Admin is not limited. The refusal says when the
// next one is available.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'
import { normalizeTier, billingWindow, LEGACY_PRO_COHORT } from '@/lib/tier'
import { utcDayStart } from '@/lib/partner-post-limit'
import { AMAZON_FIND_MOMENTS_PER_MONTH } from '@/lib/amazon-plan'

export const FIND_MOMENTS_PER_MONTH = 60
export const FIND_MOMENTS_PER_DAY_LEGACY = 10
export const FIND_MOMENTS_FEATURE = 'shorts_find'

/** Which allowance a member is on. Pure. */
export function findMomentsAllowance(cohort: string | null | undefined, tier?: string | null): { limit: number; per: 'day' | 'month' } {
  // The Amazon plan got Clip Factory on 2026-10-05 with its own allowance.
  if (tier === 'amazon') return { limit: AMAZON_FIND_MOMENTS_PER_MONTH, per: 'month' }
  return cohort === LEGACY_PRO_COHORT
    ? { limit: FIND_MOMENTS_PER_DAY_LEGACY, per: 'day' }
    : { limit: FIND_MOMENTS_PER_MONTH, per: 'month' }
}

export async function findMomentsLimit(userId: string, rawTier: unknown): Promise<NextResponse | null> {
  if (normalizeTier(rawTier) === 'admin') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    // '*' so limits_cohort (migration 405) is read when present.
    const { data: row } = await db.from('integrations').select('*').eq('user_id', userId).maybeSingle()
    const { limit, per } = findMomentsAllowance(row?.limits_cohort as string | null | undefined, normalizeTier(rawTier))
    const win = billingWindow({ periodStart: row?.subscription_period_start ?? null, periodEnd: row?.subscription_period_end ?? null })
    const since = per === 'day' ? utcDayStart().toISOString() : win.startISO
    const { count } = await db.from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', FIND_MOMENTS_FEATURE)
      .gte('created_at', since)
    if ((count ?? 0) < limit) return null
    return NextResponse.json({
      error: per === 'day'
        ? `You've found moments ${limit} times today, the daily limit. Your clips are all still here; you can find more after midnight UTC.`
        : `You've found moments ${limit} times this billing period, the monthly limit. Your clips are all still here; it resets ${win.resetLabel || 'with your next billing period'}.`,
      limitReached: true, cap: 'shorts_find',
    }, { status: 429 })
  } catch { return null } // a counting hiccup never blocks a paid action
}

export function recordFindMoments(userId: string, rawTier: unknown): void {
  recordUsage({ userId, tier: normalizeTier(rawTier), feature: FIND_MOMENTS_FEATURE, model: 'counter', images: 0 })
}
