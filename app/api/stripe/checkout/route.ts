import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe, PRICE_IDS } from '@/lib/stripe'
import type { Tier } from '@/lib/tier'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'

export async function POST(request: NextRequest) {
  // Hard stop: bulletproof gate that runs no matter how the user got
  // here (homepage CTA, direct /pricing URL, stale referrer link).
  if (SALES_PAUSED) {
    return NextResponse.json({ error: SALES_PAUSED_MESSAGE }, { status: 503 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tier, referral, couponId, promoCode } = await request.json() as {
    tier: Tier
    referral?: string | null
    couponId?: string | null
    /** Customer-facing promotion code the user typed (e.g. "EARLY20"), NOT a
     *  Stripe promo_… object id. Only used by the in-place swap below — fresh
     *  Checkout sessions get Stripe's own "Add promotion code" field. */
    promoCode?: string | null
  }
  const priceId = PRICE_IDS[tier as keyof typeof PRICE_IDS]
  if (!priceId) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const stripe = getStripe()

  // ── Existing subscriber → change plan IN PLACE with proration ────────────
  // Spinning up a fresh Checkout subscription for someone who already pays
  // would leave them with TWO live subscriptions (double-billed) and throw
  // away the money they've already paid this cycle. Instead, if they have a
  // live subscription, swap its price and let Stripe prorate: the unused
  // portion of the current plan is credited toward the new one, so they only
  // pay the difference. The customer.subscription.updated webhook maps the new
  // price → new tier; we also flip the tier here so access is instant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any)
    .from('integrations')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const customerId: string | null = ig?.stripe_customer_id ?? null

  if (customerId) {
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
      const live = subs.data.find(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status))
      const item = live?.items.data[0]
      if (live && item) {
        // Resolve a typed promotion code FIRST — before both the
        // already-on-plan short-circuit and any subscription write. Two
        // reasons: a bad code becomes a clean 400 with nothing changed, and
        // someone ALREADY on the right plan can still redeem one. That second
        // case is why this sits above the check below: handing a customer a
        // code they physically cannot enter (because they're on the plan
        // already) is the same dead end the promo field was added to remove.
        //
        // Existing subscribers get no promo field from Stripe at all — the
        // "Add promotion code" box only exists on Checkout, which this whole
        // branch skips because a second Checkout subscription would
        // double-bill them.
        let promotionCodeId: string | null = null
        const typedCode = (promoCode || '').trim()
        if (typedCode) {
          const found = await stripe.promotionCodes.list({ code: typedCode, active: true, limit: 1 })
          promotionCodeId = found.data[0]?.id ?? null
          if (!promotionCodeId) {
            return NextResponse.json({
              error: `"${typedCode}" isn't an active promo code. Check for typos — and note it's the short code (like SAVE20), not the promo_… id from Stripe.`,
            }, { status: 400 })
          }
        }

        // Already on this price → no plan change to make. Apply the discount
        // on its own if they supplied one, rather than saying nothing happened.
        if (item.price?.id === priceId) {
          if (promotionCodeId) {
            await stripe.subscriptions.update(live.id, {
              discounts: [{ promotion_code: promotionCodeId }],
              // Don't re-prorate: the price isn't moving, only the discount.
              proration_behavior: 'none',
            })
            return NextResponse.json({ updated: true, tier, alreadyOnPlan: true, discountApplied: true })
          }
          return NextResponse.json({ updated: true, tier, alreadyOnPlan: true })
        }

        // Upgrade or downgrade? Compare real Stripe amounts rather than
        // assuming tier order, so a future price change can't invert this.
        const newPrice = await stripe.prices.retrieve(priceId)
        const isUpgrade = (newPrice.unit_amount ?? 0) > (item.price?.unit_amount ?? 0)

        const updated = await stripe.subscriptions.update(live.id, {
          items: [{ id: item.id, price: priceId }],
          // UPGRADE → bill the difference NOW. With 'create_prorations' the
          // charge was deferred to the next invoice, so someone could move to
          // a higher plan, get the bigger limits instantly, and pay nothing
          // until the next billing date — or drop back down before it and
          // largely avoid paying at all. Generation is real AI spend, so that
          // window had teeth. It also made the eventual invoice look like it
          // came out of nowhere, which is exactly what confused the customer
          // who prompted this.
          //
          // DOWNGRADE → keep deferring. The proration is a CREDIT; invoicing
          // it immediately would raise a negative invoice instead of simply
          // reducing what they owe next time.
          proration_behavior: isUpgrade ? 'always_invoice' : 'create_prorations',
          // Applied in the SAME update as the price swap so the two can't land
          // half-done — Stripe either accepts both or neither.
          ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
          // Stamp so the webhook resolves user + tier directly.
          metadata: { user_id: user.id, tier },
          expand: ['latest_invoice'],
        })

        // Did the immediate charge actually clear? The price change sticks
        // either way (Stripe has moved the subscription), and the webhook is
        // the source of truth for tier — but a silent decline would leave them
        // on the new plan with an unpaid invoice and no idea, so surface it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inv = updated.latest_invoice as any
        const chargeCleared = !isUpgrade || !inv || inv.status === 'paid' || (inv.amount_due ?? 0) === 0
        const chargedAmount = isUpgrade && inv?.amount_paid ? inv.amount_paid / 100 : 0

        // Reflect the new tier immediately (webhook re-confirms it).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('integrations').update({ tier }).eq('user_id', user.id)
        return NextResponse.json({
          updated: true,
          tier,
          chargedNow: chargedAmount || undefined,
          ...(chargeCleared ? {} : {
            warning: "Your plan is switched, but the payment for the difference didn't go through. Update your card in Manage subscription so the invoice clears.",
          }),
        })
      }
      // customerId exists but no live subscription (cancelled/expired) → fall
      // through to a fresh Checkout below.
    } catch (err) {
      // If the in-place swap fails for any reason, don't fall through to a new
      // subscription (that would double-bill). Surface the error instead.
      const msg = err instanceof Error ? err.message : 'Could not change your plan. Please try again or use Manage subscription.'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { user_id: user.id, tier },
    // Also stamp the SUBSCRIPTION with the same metadata. Stripe does NOT copy
    // checkout-session metadata onto the subscription, so without this the
    // customer.subscription.created/updated events carry no user_id and the
    // webhook can only match by stripe_customer_id — which isn't linked yet on
    // a first purchase. Stamping the subscription lets the webhook upsert by
    // user_id directly, so the upgrade applies even if checkout.session.completed
    // is delayed or not subscribed in the dashboard.
    subscription_data: { metadata: { user_id: user.id, tier } },
    // Rewardful double-sided incentives vs manual promo codes —
    // Stripe makes these mutually exclusive on a Checkout session
    // (passing both 422s the request). So if Rewardful sent us a
    // coupon from the affiliate cookie (the visitor arrived via an
    // affiliate link and the campaign has the incentive enabled),
    // auto-apply that coupon. Otherwise show the "Add promotion code"
    // field for manual entry — same UX everyone else gets.
    ...(couponId
      ? { discounts: [{ coupon: couponId }] }
      : { allow_promotion_codes: true }),
    // Rewardful affiliate attribution — the referral UUID lives in
    // client_reference_id, which Rewardful's Stripe webhook reads to
    // attribute the conversion to the correct affiliate.
    ...(referral ? { client_reference_id: referral } : {}),
    success_url: `${appUrl}/billing?upgraded=1`,
    cancel_url: `${appUrl}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
