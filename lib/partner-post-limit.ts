// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE PARTNER POST A DAY. A post from MVP x LTK, Levanta, Walmart or Wayward
// runs the campaign writer, web research and a hero image (about $0.50), and
// none of the four had any limit of their own (Seb, 2026-10-05: "a limit of
// one post a day"). One shared count across the four, per user, per UTC day.
// Admin is not limited. The refusal says when the next one is available.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'
import { normalizeTier } from '@/lib/tier'

export const PARTNER_POSTS_PER_DAY = 1
export const PARTNER_POST_FEATURE = 'partner_post'

/** Start of the current UTC day. Pure. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** A 429 when today's partner post is already made, else null. */
export async function partnerPostLimit(userId: string, rawTier: unknown): Promise<NextResponse | null> {
  if (normalizeTier(rawTier) === 'admin') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (createAdminClient() as any).from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', PARTNER_POST_FEATURE)
      .gte('created_at', utcDayStart().toISOString())
    if ((count ?? 0) < PARTNER_POSTS_PER_DAY) return null
  } catch { return null } // a counting hiccup never blocks a paid action
  return NextResponse.json({
    ok: false, limitReached: true, cap: 'partner_post',
    error: `You can make ${PARTNER_POSTS_PER_DAY} LTK, Levanta, Walmart or Wayward post a day, and today's is done. The next one is available after midnight UTC.`,
  }, { status: 429 })
}

/** Count a partner post that was published. The row costs nothing ('counter'
 *  is priced at zero); the post's real spend is recorded by its own calls. */
export function recordPartnerPost(userId: string, rawTier: unknown): void {
  recordUsage({ userId, tier: normalizeTier(rawTier), feature: PARTNER_POST_FEATURE, model: 'counter', images: 0 })
}
