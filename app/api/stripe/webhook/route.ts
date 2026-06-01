import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Tier } from '@/lib/tier'

export const config = { api: { bodyParser: false } }

// $49 Creator price = the existing STRIPE_PRICE_STARTER (renamable via
// STRIPE_PRICE_CREATOR). $99 Studio = STRIPE_PRICE_STUDIO. $199 = Pro.
// When an env var is unset, the resulting `undefined` key would silently mis-
// map a paying customer's webhook to whatever tier shared the empty slot —
// so we filter undefined keys out instead of `process.env.X!`-ing them.
const PRICE_TO_TIER: Record<string, Tier> = Object.fromEntries(
  (
    [
      [process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER, 'creator'],
      [process.env.STRIPE_PRICE_STUDIO, 'studio'],
      [process.env.STRIPE_PRICE_PRO, 'pro'],
    ] as Array<[string | undefined, Tier]>
  ).filter(([id]) => !!id) as Array<[string, Tier]>,
)

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

  // Handle .created the same as .updated so a fresh Pro signup gets
  // subscription_period_start/end populated immediately (not on the
  // next Stripe event). Without this the dashboard falls back to
  // calendar-month wording until the next renewal/portal action.
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as {
      id: string
      customer: string
      items: { data: { price: { id: string } }[] }
      status: string
      cancel_at_period_end?: boolean
      current_period_start?: number
      current_period_end?: number
      metadata?: { user_id?: string; tier?: Tier }
    }
    const priceId = sub.items.data[0]?.price.id
    // Prefer the env price→tier map; fall back to the tier we stamped on the
    // subscription at checkout so a stale/missing env mapping can't silently
    // skip the upgrade.
    const tier = PRICE_TO_TIER[priceId] ?? sub.metadata?.tier
    const userId = sub.metadata?.user_id
    if (tier) {
      const fields = {
        tier,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        subscription_status: sub.cancel_at_period_end ? 'canceling' : sub.status,
        subscription_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        subscription_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      }
      // If we know the user_id (stamped on the subscription at checkout), upsert
      // by user_id — this links the row + applies the tier even when
      // checkout.session.completed hasn't run yet (no chicken-and-egg on the
      // stripe_customer_id). Otherwise fall back to matching by customer id
      // (renewals / older subscriptions without our metadata).
      if (userId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('integrations').upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' })
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('integrations').update(fields).eq('stripe_customer_id', sub.customer)
      }
    } else {
      console.warn('[stripe-webhook] subscription event with no resolvable tier', { priceId, subId: sub.id, hasMetaTier: !!sub.metadata?.tier })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { customer: string }
    // Downgrade to the free Trial when subscription cancelled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('integrations')
      .update({
        tier: 'trial',
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
