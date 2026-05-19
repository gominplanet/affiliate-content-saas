import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Tier } from '@/lib/tier'

export const config = { api: { bodyParser: false } }

const PRICE_TO_TIER: Record<string, Tier> = {
  [process.env.STRIPE_PRICE_STARTER!]: 'starter',
  [process.env.STRIPE_PRICE_GROWTH!]: 'growth',
  [process.env.STRIPE_PRICE_PRO!]: 'pro',
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  const stripe = getStripe()
  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Use the service-role client so writes succeed regardless of RLS — Stripe
  // webhooks have no authenticated user cookie, so the SSR cookie client
  // would be blocked by row-level security on `integrations`.
  const admin = createAdminClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as unknown as {
      metadata: { user_id: string; tier: Tier }
      customer: string
      subscription: string
    }
    const { user_id, tier } = session.metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('integrations').upsert(
      {
        user_id,
        tier,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_status: 'active',
      },
      { onConflict: 'user_id' },
    )
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as {
      id: string
      customer: string
      items: { data: { price: { id: string } }[] }
      status: string
      cancel_at_period_end?: boolean
      current_period_start?: number
      current_period_end?: number
    }
    const priceId = sub.items.data[0]?.price.id
    const tier = PRICE_TO_TIER[priceId]
    if (tier) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('integrations')
        .update({
          tier,
          stripe_subscription_id: sub.id,
          subscription_status: sub.cancel_at_period_end ? 'canceling' : sub.status,
          subscription_period_start: sub.current_period_start
            ? new Date(sub.current_period_start * 1000).toISOString()
            : null,
          subscription_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
        })
        .eq('stripe_customer_id', sub.customer)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { customer: string }
    // Downgrade to free when subscription cancelled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('integrations')
      .update({
        tier: 'free',
        stripe_subscription_id: null,
        subscription_status: 'canceled',
        subscription_period_start: null,
        subscription_period_end: null,
      })
      .eq('stripe_customer_id', sub.customer)
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as { customer: string }
    // Mark as past_due so the UI can show a warning. We do NOT downgrade
    // immediately — Stripe will retry per the dunning settings, and emit
    // customer.subscription.deleted if it eventually gives up.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('integrations')
      .update({ subscription_status: 'past_due' })
      .eq('stripe_customer_id', invoice.customer)
  }

  return NextResponse.json({ received: true })
}
