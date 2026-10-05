// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMAZON LIVE ON THE AMAZON PLAN: 4 SHOWS A MONTH (lib/amazon-plan).
//
// The Amazon plan got Amazon Live prep and follow-up on 2026-10-05. Each is
// counted in the member's billing period: a prep is a show plan written (the
// ai_usage row the plan route records when the writer answered), a follow-up
// is a replay started. Pro and admin are not limited here; the monthly spend
// ceiling still holds every plan. A counting hiccup never blocks: the spend
// ceiling is the backstop.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingWindow, normalizeTier } from '@/lib/tier'
import { AMAZON_LIVE_SHOWS_PER_MONTH } from '@/lib/amazon-plan'

export async function amazonLiveLimit(userId: string, rawTier: unknown, kind: 'plan' | 'followup'): Promise<NextResponse | null> {
  if (normalizeTier(rawTier) !== 'amazon') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    const { data: row } = await db.from('integrations').select('*').eq('user_id', userId).maybeSingle()
    const win = billingWindow({ periodStart: row?.subscription_period_start ?? null, periodEnd: row?.subscription_period_end ?? null })
    const { count } = kind === 'plan'
      ? await db.from('ai_usage').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('feature', 'amazon_live_plan').gte('created_at', win.startISO)
      : await db.from('live_followups').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', win.startISO)
    if ((count ?? 0) < AMAZON_LIVE_SHOWS_PER_MONTH) return null
    const what = kind === 'plan' ? 'show plans' : 'Live follow-ups'
    return NextResponse.json({
      error: `You've made ${AMAZON_LIVE_SHOWS_PER_MONTH} ${what} this billing period, the Amazon plan's monthly allowance. It resets ${win.resetLabel || 'with your next billing period'}; Pro has no monthly limit on Amazon Live.`,
      limitReached: true, cap: kind === 'plan' ? 'amazon_live_plan' : 'live_followup',
    }, { status: 429 })
  } catch {
    return null
  }
}
