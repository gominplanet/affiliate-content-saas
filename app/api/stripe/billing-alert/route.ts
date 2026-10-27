// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/stripe/billing-alert — whether this member's payment is failing,
// or their plan ended because it did (lib/billing-alert). Read from MVP's own
// row; only a plan that ended before MVP kept the reason asks Stripe why, once,
// and the answer is kept so it is not asked again.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'
import { billingAlertOf, ENDED_UNPAID } from '@/lib/billing-alert'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('integrations').select('tier, subscription_status, stripe_customer_id').eq('user_id', user.id).maybeSingle()
  const status = (row?.subscription_status as string | null) ?? null
  let endedReason: string | null = null
  let endedAt: string | null = null
  if ((status === 'canceled' || status === ENDED_UNPAID) && row?.stripe_customer_id) {
    try {
      const subs = await getStripe().subscriptions.list({ customer: row.stripe_customer_id, status: 'all', limit: 5 })
      // A live one means nothing ended: the member is back.
      if (subs.data.some((s) => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status))) return NextResponse.json({ alert: null })
      const last = subs.data.filter((s) => s.status === 'canceled').sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0))[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      endedReason = ((last as any)?.cancellation_details?.reason as string | undefined) ?? null
      endedAt = last?.ended_at ? new Date(last.ended_at * 1000).toISOString() : null
      // Kept, so the reason is read from Stripe once.
      if (status === 'canceled' && endedReason === 'payment_failed') await admin.from('integrations').update({ subscription_status: ENDED_UNPAID }).eq('user_id', user.id).eq('subscription_status', 'canceled')
    } catch { /* Stripe did not answer: an ended plan MVP kept the reason for is still said */ }
  }
  return NextResponse.json({ alert: billingAlertOf({ status, tier: row?.tier ?? null, endedReason, endedAt }) })
}
