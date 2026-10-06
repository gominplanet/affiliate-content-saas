// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE AMAZON PLAN'S 150 DEAL POSTS A MONTH, COUNTED WHERE THEY ARE MADE.
//
// The pricing pages promise the Amazon plan TIERS.amazon.dealsPerMonth deal
// posts a month, and the only allowance that read it counted WordPress deal
// posts, which the Amazon plan cannot make. Its deals go out through Deal
// Radar's quick post (Pinterest, Facebook, an Instagram card and Story), which
// counted nothing. Since 2026-10-05 (Seb's six Amazon additions) each quick
// post, sent now or scheduled, counts one. Other plans are unchanged: their
// deal posts are counted where they publish to the blog. Checked before the
// post, counted after it went (or was queued). A counting hiccup never blocks:
// the monthly spend ceiling is the backstop.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordUsage } from '@/lib/ai-usage'
import { TIERS, billingWindow, normalizeTier } from '@/lib/tier'

export const DEAL_POST_FEATURE = 'deal_quick_post'

export async function dealPostLimit(userId: string, rawTier: unknown): Promise<NextResponse | null> {
  if (normalizeTier(rawTier) !== 'amazon') return null
  const limit = TIERS.amazon.dealsPerMonth
  if (limit == null) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    const { data: row } = await db.from('integrations').select('*').eq('user_id', userId).maybeSingle()
    const win = billingWindow({ periodStart: row?.subscription_period_start ?? null, periodEnd: row?.subscription_period_end ?? null })
    const { count } = await db.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('feature', DEAL_POST_FEATURE).gte('created_at', win.startISO)
    if ((count ?? 0) < limit) return null
    return NextResponse.json({
      error: `You've made ${limit} deal posts this billing period, the Amazon plan's monthly allowance. It resets ${win.resetLabel || 'with your next billing period'}.`,
      limitReached: true, cap: 'deals',
    }, { status: 429 })
  } catch { return null }
}

export function recordDealPost(userId: string, rawTier: unknown): void {
  if (normalizeTier(rawTier) !== 'amazon') return
  recordUsage({ userId, tier: 'amazon', feature: DEAL_POST_FEATURE, model: 'counter', images: 0 })
}
