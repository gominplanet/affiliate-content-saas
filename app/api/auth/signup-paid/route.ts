import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe, PRICE_IDS } from '@/lib/stripe'
import type { Tier } from '@/lib/tier'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'

/**
 * Paid signup in ONE flow: create the account + send the user straight to
 * Stripe — no email-confirmation interrupt.
 *
 * Why this exists: the normal /signup form requires the user to click a
 * confirmation email before they have a session, which means a visitor who
 * clicked "Get Pro" can't pay in one go — they sign up, confirm, and land on
 * trial. For a PAID plan we instead create the account already-confirmed
 * (they're about to pay, so they're real), sign them in, and hand back a Stripe
 * Checkout URL. The trial signup flow is unchanged and still confirms email.
 *
 * The tier is NOT granted here — it only applies when Stripe fires
 * checkout.session.completed / customer.subscription.* and the webhook upserts
 * it by the user_id we stamp on the session + subscription. So an abandoned
 * checkout just leaves a normal trial account, exactly like a trial signup.
 */
const PAID_TIERS: Tier[] = ['creator', 'studio', 'pro']

export async function POST(request: NextRequest) {
  if (SALES_PAUSED) {
    return NextResponse.json({ error: SALES_PAUSED_MESSAGE }, { status: 503 })
  }

  const { email, password, fullName, tier, referral, couponId } = (await request.json()) as {
    email?: string
    password?: string
    fullName?: string
    tier?: Tier
    referral?: string | null
    couponId?: string | null
  }

  const cleanEmail = (email || '').trim().toLowerCase()
  if (!cleanEmail || !password || password.length < 8) {
    return NextResponse.json(
      { error: 'Enter an email and a password of at least 8 characters.' },
      { status: 400 },
    )
  }
  if (!tier || !PAID_TIERS.includes(tier)) {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 })
  }
  const priceId = PRICE_IDS[tier as keyof typeof PRICE_IDS]
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Create the account already email-confirmed. These users are about to pay,
  // so they're real; pre-confirming is what lets us skip the confirmation email
  // and send them straight to Stripe in a single flow.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || '' },
  })

  if (createErr || !created?.user) {
    const msg = createErr?.message || 'Could not create your account.'
    // Most common case: the email already has an account. Send them to sign in
    // and upgrade from inside the app rather than silently failing here.
    const already = /already|exists|registered/i.test(msg)
    return NextResponse.json(
      {
        error: already
          ? 'An account with this email already exists. Please sign in to upgrade.'
          : msg,
        code: already ? 'exists' : 'create_failed',
      },
      { status: already ? 409 : 400 },
    )
  }

  const userId = created.user.id

  // Sign them in now so the session cookie is set on this response — when they
  // return from Stripe after paying they're already logged in and land on their
  // dashboard. email_confirm:true above means this isn't blocked by an
  // "email not confirmed" error. Non-fatal if it fails: the webhook still
  // applies the tier by user_id, and they can sign in afterward.
  try {
    const supabase = await createServerClient()
    await supabase.auth.signInWithPassword({ email: cleanEmail, password })
  } catch {
    /* best-effort cookie session */
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: cleanEmail,
    // Stamp BOTH the session and the subscription with user_id + tier so the
    // webhook can apply the upgrade regardless of which event arrives first
    // (mirrors /api/stripe/checkout).
    metadata: { user_id: userId, tier },
    subscription_data: { metadata: { user_id: userId, tier } },
    // Rewardful coupon (double-sided incentive) and manual promo codes are
    // mutually exclusive on a Checkout session — pick one.
    ...(couponId ? { discounts: [{ coupon: couponId }] } : { allow_promotion_codes: true }),
    // Rewardful affiliate attribution.
    ...(referral ? { client_reference_id: referral } : {}),
    success_url: `${appUrl}/billing?upgraded=1`,
    cancel_url: `${appUrl}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
