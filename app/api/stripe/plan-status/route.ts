/**
 * GET /api/stripe/plan-status
 *
 * Read-only. Tells the billing page whether the subscriber has a PENDING
 * end-of-period downgrade queued (via a Stripe subscription schedule, set by
 * the checkout route). Used to show a "Scheduled: moving to X on <date>" note so
 * a downgrade the user queued is visible on every visit, not just at the moment
 * they clicked it. Returns { pendingDowngrade: { tier, effectiveAt } | null }.
 *
 * effectiveAt is unix seconds (the current period end / phase-2 start).
 *
 * Also returns `paying`: what this member is actually charged ({ amountUsd,
 * interval }, from the live subscription's price, after no discounts). The
 * billing page shows that, not the new-member price in lib/tier, because a
 * member who joined Pro at $199 still pays $199 after Pro went to $299.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe, isLockedInPrice } from '@/lib/stripe'
import type { Tier } from '@/lib/tier'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (supabase as any)
      .from('integrations').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    const customerId: string | null = ig?.stripe_customer_id ?? null
    if (!customerId) return NextResponse.json({ pendingDowngrade: null, paying: null })

    const stripe = getStripe()
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
    const live = subs.data.find(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status))
    const livePrice = live?.items?.data?.[0]?.price
    // lockedIn: on a price from before the November 1 change, so plan changes
    // keep that price level (lib/stripe planChangePriceId).
    const paying = livePrice?.unit_amount != null
      ? { amountUsd: livePrice.unit_amount / 100, interval: livePrice.recurring?.interval === 'year' ? 'year' : 'month', lockedIn: isLockedInPrice(livePrice.id) }
      : null
    if (!live?.schedule) return NextResponse.json({ pendingDowngrade: null, paying })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedId = typeof live.schedule === 'string' ? live.schedule : (live.schedule as any).id
    const sched = await stripe.subscriptionSchedules.retrieve(schedId)
    if (sched.status !== 'active' && sched.status !== 'not_started') {
      return NextResponse.json({ pendingDowngrade: null, paying })
    }
    const targetTier = (sched.metadata?.mvp_downgrade_to as Tier | undefined) || null
    const nowSec = Math.floor(Date.now() / 1000)
    // The next phase that hasn't started yet is the queued downgrade.
    const nextPhase = (sched.phases || []).find(p => (p.start_date ?? 0) > nowSec)
    if (!targetTier || !nextPhase) return NextResponse.json({ pendingDowngrade: null, paying })

    return NextResponse.json({
      pendingDowngrade: { tier: targetTier, effectiveAt: nextPhase.start_date },
      paying,
    })
  } catch (err) {
    // Best-effort — never break the billing page over a Stripe hiccup.
    console.error('[plan-status]', err instanceof Error ? err.message : err)
    return NextResponse.json({ pendingDowngrade: null, paying: null })
  }
}
