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
import { normalizeTier, TIERS } from '@/lib/tier'

export const PARTNER_POSTS_PER_DAY = 1
export const PARTNER_POST_FEATURE = 'partner_post'

/** Start of the current UTC day. Pure. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** A 429 when today's partner post is already made, else null. */
export async function partnerPostLimit(userId: string, rawTier: unknown): Promise<NextResponse | null> {
  const tier = normalizeTier(rawTier)
  if (tier === 'admin') return null
  // These are blog posts, and a plan with no blog (Amazon: sites 0) does not
  // include them. Said here because a downgraded account can still carry an
  // old WordPress connection that the routes would otherwise publish through.
  if ((TIERS[tier]?.sites ?? 0) === 0) {
    return NextResponse.json({ ok: false, error: 'LTK, Levanta, Walmart and Wayward posts publish to your blog, which is part of the Pro plan.', upgrade: true }, { status: 403 })
  }
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
