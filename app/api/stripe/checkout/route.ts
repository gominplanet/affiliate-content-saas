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

  const { tier, referral } = await request.json() as { tier: Tier; referral?: string | null }
  const priceId = PRICE_IDS[tier as keyof typeof PRICE_IDS]
  if (!priceId) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { user_id: user.id, tier },
    // Rewardful affiliate attribution — the referral UUID lives in
    // client_reference_id, which Rewardful's Stripe webhook reads to
    // attribute the conversion to the correct affiliate.
    ...(referral ? { client_reference_id: referral } : {}),
    success_url: `${appUrl}/billing?upgraded=1`,
    cancel_url: `${appUrl}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
