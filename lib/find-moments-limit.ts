// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TEN "FIND MOMENTS" A DAY. Each Clip Factory search pulls the video, transcribes
// it and runs the planner (about $0.20), and it had no limit of its own (Seb,
// 2026-10-05: "10 a day"). Counted once per search that found moments; "Post the
// whole video" is not a search and is not counted. Per user, per UTC day; admin
// is not limited, and the refusal says when the next one is available.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'
import { normalizeTier } from '@/lib/tier'
import { utcDayStart } from '@/lib/partner-post-limit'

export const FIND_MOMENTS_PER_DAY = 10
export const FIND_MOMENTS_FEATURE = 'shorts_find'

export async function findMomentsLimit(userId: string, rawTier: unknown): Promise<NextResponse | null> {
  if (normalizeTier(rawTier) === 'admin') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (createAdminClient() as any).from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', FIND_MOMENTS_FEATURE)
      .gte('created_at', utcDayStart().toISOString())
    if ((count ?? 0) < FIND_MOMENTS_PER_DAY) return null
  } catch { return null }
  return NextResponse.json({
    error: `You've found moments ${FIND_MOMENTS_PER_DAY} times today, the daily limit. Your clips are all still here; you can find more after midnight UTC.`,
    limitReached: true, cap: 'shorts_find',
  }, { status: 429 })
}

export function recordFindMoments(userId: string, rawTier: unknown): void {
  recordUsage({ userId, tier: normalizeTier(rawTier), feature: FIND_MOMENTS_FEATURE, model: 'counter', images: 0 })
}
