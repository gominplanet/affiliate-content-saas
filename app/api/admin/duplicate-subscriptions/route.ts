/**
 * Admin-only — find + clean up customers with MORE THAN ONE live Stripe
 * subscription. Before the 2026-07-01 proration fix, the /billing plan buttons
 * created a NEW subscription on every upgrade, so some existing subscribers got
 * double-billed (two active subs). This surfaces them and lets you cancel the
 * extra (and optionally refund its last payment).
 *
 * GET  → scan: returns each customer with >= 2 live subscriptions, enriched
 *        with their MVP email/tier and each subscription's plan + amount.
 * POST → action on ONE subscription:
 *        { action: 'cancel', subscriptionId }               — cancel now
 *        { action: 'refund', subscriptionId }               — refund its latest
 *          paid invoice (does NOT cancel — pair with a cancel if you want both)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, PRICE_IDS } from '@/lib/stripe'
import type { Tier } from '@/lib/tier'

// Invert PRICE_IDS → tier, so we can label each subscription's plan.
const PRICE_TO_TIER: Record<string, Tier> = Object.fromEntries(
  (Object.entries(PRICE_IDS) as [Tier, string][])
    .filter(([, id]) => !!id)
    .map(([tier, id]) => [id, tier]),
)

const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'] as const

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) }
  return { ok: true as const }
}

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const stripe = getStripe()

  // 1. Collect all LIVE subscriptions, grouped by customer. Paginate defensively
  //    (cap ~4000 subs). One list call per live status.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCustomer = new Map<string, any[]>()
  for (const status of LIVE_STATUSES) {
    let startingAfter: string | undefined
    for (let page = 0; page < 40; page++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await stripe.subscriptions.list({
        status, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const s of res.data) {
        const cust = typeof s.customer === 'string' ? s.customer : s.customer?.id
        if (!cust) continue
        const arr = byCustomer.get(cust) ?? []
        arr.push(s); byCustomer.set(cust, arr)
      }
      if (!res.has_more) break
      startingAfter = res.data[res.data.length - 1]?.id
    }
  }

  // 2. Keep only customers with 2+ live subs (dedupe subs by id in case a
  //    status pass overlapped).
  const dupCustomers = [...byCustomer.entries()]
    .map(([cust, subs]) => {
      const seen = new Set<string>()
      const uniq = subs.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)))
      return { cust, subs: uniq }
    })
    .filter(x => x.subs.length >= 2)

  if (dupCustomers.length === 0) return NextResponse.json({ ok: true, duplicates: [] })

  // 3. Enrich with MVP account (email/tier) via integrations (service role,
  //    cross-user) + the Stripe customer email as a fallback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const custIds = dupCustomers.map(d => d.cust)
  const { data: integ } = await admin
    .from('integrations')
    .select('user_id, tier, stripe_customer_id')
    .in('stripe_customer_id', custIds)
  const integByCust = new Map<string, { user_id: string; tier: string }>()
  for (const row of (integ ?? [])) integByCust.set(row.stripe_customer_id, { user_id: row.user_id, tier: row.tier })

  const duplicates = []
  for (const { cust, subs } of dupCustomers) {
    let email: string | null = integByCust.get(cust) ? null : null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customer: any = await stripe.customers.retrieve(cust)
      email = customer?.email ?? null
    } catch { /* deleted customer / API hiccup — leave null */ }

    const mvp = integByCust.get(cust) ?? null
    duplicates.push({
      customerId: cust,
      email,
      mvpUserId: mvp?.user_id ?? null,
      mvpTier: mvp?.tier ?? null,
      subscriptions: subs
        .map(s => {
          const item = s.items?.data?.[0]
          const price = item?.price
          const priceId = price?.id as string | undefined
          return {
            id: s.id as string,
            status: s.status as string,
            planTier: (priceId && PRICE_TO_TIER[priceId]) || 'unknown',
            priceId: priceId ?? null,
            amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
            interval: price?.recurring?.interval ?? null,
            created: s.created ? new Date(s.created * 1000).toISOString() : null,
            currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
            latestInvoice: typeof s.latest_invoice === 'string' ? s.latest_invoice : (s.latest_invoice?.id ?? null),
          }
        })
        // Oldest first — the oldest is usually the "real" one to KEEP; the
        // newer duplicate is the one to cancel/refund.
        .sort((a, b) => (a.created || '').localeCompare(b.created || '')),
    })
  }

  return NextResponse.json({ ok: true, count: duplicates.length, duplicates })
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({})) as { action?: 'cancel' | 'refund'; subscriptionId?: string }
  const subscriptionId = (body.subscriptionId || '').trim()
  if (!subscriptionId) return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 })

  const stripe = getStripe()

  try {
    if (body.action === 'cancel') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: any = await stripe.subscriptions.cancel(subscriptionId)
      return NextResponse.json({ ok: true, action: 'cancel', subscriptionId, status: sub.status })
    }

    if (body.action === 'refund') {
      // Refund the subscription's latest paid invoice. Requires an explicit
      // action — never happens automatically.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: any = await stripe.subscriptions.retrieve(subscriptionId)
      const invId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id
      if (!invId) return NextResponse.json({ error: 'No invoice found on this subscription' }, { status: 400 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inv: any = await stripe.invoices.retrieve(invId)
      const paymentIntent = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id
      const charge = typeof inv.charge === 'string' ? inv.charge : inv.charge?.id
      if (!paymentIntent && !charge) return NextResponse.json({ error: 'That invoice has no captured payment to refund (maybe $0 / unpaid).' }, { status: 400 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refund: any = await stripe.refunds.create(
        paymentIntent ? { payment_intent: paymentIntent } : { charge: charge as string },
      )
      return NextResponse.json({ ok: true, action: 'refund', subscriptionId, refundId: refund.id, amount: (refund.amount ?? 0) / 100, invoiceId: invId })
    }

    return NextResponse.json({ error: "action must be 'cancel' or 'refund'" }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe action failed' }, { status: 500 })
  }
}
