/**
 * POST /api/stripe/preview-upgrade  { tier }
 *
 * Tells an existing subscriber, BEFORE they confirm, what a plan change will
 * cost them today — the prorated amount Stripe would invoice immediately on an
 * upgrade (mirrors the checkout route's `always_invoice` behavior), or that a
 * downgrade is a deferred credit with no charge now. Read-only: it previews the
 * invoice via Stripe, it never bills. This is the fix for "why was I charged
 * $X?" — the number is shown up front.
 *
 * Returns one of:
 *   { kind: 'new' }                              new subscriber → Checkout (price shown there)
 *   { kind: 'same' }                             already on this plan
 *   { kind: 'upgrade', chargeNow, nextPrice }    immediate prorated charge (dollars); null if preview unavailable
 *   { kind: 'downgrade', nextPrice }             credit applied to next invoice, no charge today
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe, PRICE_IDS } from '@/lib/stripe'
import type { Tier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { tier } = await request.json() as { tier: Tier }
    const priceId = PRICE_IDS[tier as keyof typeof PRICE_IDS]
    if (!priceId) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })

    const stripe = getStripe()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (supabase as any)
      .from('integrations').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    const customerId: string | null = ig?.stripe_customer_id ?? null
    if (!customerId) return NextResponse.json({ kind: 'new' })

    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
    const live = subs.data.find(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status))
    const item = live?.items.data[0]
    if (!live || !item) return NextResponse.json({ kind: 'new' })
    if (item.price?.id === priceId) return NextResponse.json({ kind: 'same' })

    const newPrice = await stripe.prices.retrieve(priceId)
    const nextPrice = (newPrice.unit_amount ?? 0) / 100
    const isUpgrade = (newPrice.unit_amount ?? 0) > (item.price?.unit_amount ?? 0)

    // Downgrade → takes effect at PERIOD END. Nothing is charged now; the
    // customer keeps their current plan until the paid period lapses, then moves
    // to the lower one (the checkout route schedules this).
    if (!isUpgrade) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const effectiveAt = (live as any).current_period_end ?? null
      return NextResponse.json({ kind: 'downgrade', nextPrice, effectiveAt })
    }

    // Upgrade → preview the invoice Stripe would raise immediately. amount_due
    // is the prorated charge (rest-of-cycle difference + the new period, as on
    // the real invoice). Best-effort: if the preview can't be built we still let
    // the UI confirm, just without a number.
    let chargeNow: number | null = null
    try {
      // createPreview is the modern upcoming-invoice preview (Stripe ≥ 2025).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const preview = await (stripe.invoices as any).createPreview({
        customer: customerId,
        subscription: live.id,
        subscription_details: {
          items: [{ id: item.id, price: priceId }],
          proration_behavior: 'always_invoice',
          proration_date: Math.floor(Date.now() / 1000),
        },
      })
      const due = Number(preview?.amount_due)
      if (Number.isFinite(due)) chargeNow = Math.max(0, due) / 100
    } catch (e) {
      console.error('[preview-upgrade] createPreview failed', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ kind: 'upgrade', chargeNow, nextPrice })
  } catch (err) {
    console.error('[preview-upgrade]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't preview that change just now. Please try again in a moment.") }, { status: 500 })
  }
}
