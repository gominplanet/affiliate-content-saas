import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createServerClient } from '@/lib/supabase/server'
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

  const supabase = await createServerClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { metadata: { user_id: string; tier: Tier }; customer: string; subscription: string }
    const { user_id, tier } = session.metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      { user_id, tier, stripe_customer_id: session.customer, stripe_subscription_id: session.subscription },
      { onConflict: 'user_id' },
    )
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as { id: string; customer: string; items: { data: { price: { id: string } }[] }; status: string }
    const priceId = sub.items.data[0]?.price.id
    const tier = PRICE_TO_TIER[priceId]
    if (tier) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('integrations')
        .update({ tier, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { customer: string }
    // Downgrade to starter when subscription cancelled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations')
      .update({ tier: 'starter', stripe_subscription_id: null })
      .eq('stripe_customer_id', sub.customer)
  }

  return NextResponse.json({ received: true })
}
