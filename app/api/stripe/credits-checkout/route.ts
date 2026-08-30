// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/stripe/credits-checkout — buy a one-time block of "your-voice" dub
// credits. Creates a Stripe Checkout session in payment mode; the webhook adds
// the credits to the ledger on completion (from the real purchased price, never
// client-supplied amounts). Pro-only.
//   body: { block: '50' | '150' | '500' }  ->  { url }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe, CREDIT_BLOCKS, creditBlockPriceId, isValidPriceId } from '@/lib/stripe'
import { normalizeTier } from '@/lib/tier'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { block } = await request.json().catch(() => ({})) as { block?: string }
  const key = String(block || '').trim()
  const cfg = CREDIT_BLOCKS[key]
  if (!cfg) return NextResponse.json({ error: 'Unknown credit block.' }, { status: 400 })
  const priceId = creditBlockPriceId(key)
  if (!isValidPriceId(priceId)) {
    return NextResponse.json({ error: 'Credit purchases are not available just yet.' }, { status: 503 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations').select('tier,stripe_customer_id').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Your-voice credits are a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const stripe = getStripe()
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId as string, quantity: 1 }],
      ...(integ?.stripe_customer_id ? { customer: integ.stripe_customer_id } : { customer_email: user.email ?? undefined }),
      // The webhook credits from the ACTUAL price; user_id routes it to the
      // right account, creditBlock is informational only.
      metadata: { user_id: user.id, creditBlock: key },
      success_url: `${appUrl}/global-sync?credits=ok`,
      cancel_url: `${appUrl}/global-sync?credits=cancel`,
      allow_promotion_codes: false,
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start checkout.' }, { status: 502 })
  }
}
