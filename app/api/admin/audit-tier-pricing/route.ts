/**
 * GET /api/admin/audit-tier-pricing
 *
 * Admin-only. Finds paying users whose ACTUAL Stripe subscription price is
 * cheaper than their tier should cost — i.e. the "$49 price granting Pro" leak.
 * For every user on a paid tier (creator / studio / pro) we read their live
 * Stripe subscription, look at the price's LIST amount (unit_amount — discounts
 * never change it), and flag anyone whose price is below the tier's floor.
 *
 * Read-only: it never changes a tier or a subscription. It just reports, so you
 * can fix the mispriced ones by hand in Stripe.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Same floors as the webhook guard (cents): below these, a paid tier is being
// granted for less than intended.
const TIER_MIN_CENTS: Record<string, number> = { creator: 4000, studio: 8000, pro: 15000 }

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const admin = createAdminClient()
  const stripe = getStripe()

  // Everyone on a paid tier who has a Stripe subscription on file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from('integrations')
    .select('user_id, tier, stripe_subscription_id, stripe_customer_id')
    .in('tier', ['creator', 'studio', 'pro'])
    .not('stripe_subscription_id', 'is', null)
  const users = (rows ?? []) as Array<{ user_id: string; tier: string; stripe_subscription_id: string | null; stripe_customer_id: string | null }>

  const flagged: Array<Record<string, unknown>> = []
  const errors: Array<Record<string, unknown>> = []

  for (const u of users) {
    if (!u.stripe_subscription_id) continue
    try {
      const sub = await stripe.subscriptions.retrieve(u.stripe_subscription_id)
      const item = sub.items?.data?.[0]
      const price = item?.price
      const amount = price?.unit_amount ?? null
      const floor = TIER_MIN_CENTS[u.tier]
      if (floor != null && amount != null && amount < floor) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const productId = typeof price?.product === 'string' ? price.product : (price?.product as any)?.id ?? null
        flagged.push({
          userId: u.user_id,
          tier: u.tier,
          chargedPrice: `$${(amount / 100).toFixed(2)}`,
          expectedAtLeast: `$${(floor / 100).toFixed(0)}`,
          priceId: price?.id ?? null,
          productId,
          subscriptionId: sub.id,
          status: sub.status,
          customerId: u.stripe_customer_id,
        })
      }
    } catch (e) {
      errors.push({ userId: u.user_id, subscriptionId: u.stripe_subscription_id, error: e instanceof Error ? e.message : 'lookup failed' })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: users.length,
    flaggedCount: flagged.length,
    flagged,           // paid tiers on a too-cheap price — fix these in Stripe
    errors,            // subscriptions we couldn't read (cancelled/deleted/etc.)
  })
}
