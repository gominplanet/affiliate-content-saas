import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any)
    .from('integrations')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!ig?.stripe_customer_id) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 400 })
  }

  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: ig.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
  })

  return NextResponse.json({ url: session.url })
}
