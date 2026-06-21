import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertOps } from '@/lib/ops-alert'
import type { Tier } from '@/lib/tier'

/**
 * A tier-write failed. Release this event's idempotency claim so Stripe's retry
 * RE-processes it (without this, the dedup gate would 200 the retry and the
 * write would never be re-attempted), alert the operator (a paid customer may
 * be stuck on their old tier), and return 500 so Stripe retries. Retries are
 * safe — the idempotency gate makes reprocessing idempotent.
 */
async function releaseAndRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, eventId: string, label: string, error: { message?: string } | null,
): Promise<NextResponse> {
  console.error(`[stripe-webhook] ${label} DB write failed`, { eventId, error: error?.message })
  try { await admin.from('stripe_webhook_events').delete().eq('event_id', eventId) } catch { /* best-effort */ }
  await alertOps(
    `Stripe webhook ${label} failed to write — a paid tier may not have applied`,
    `event_id ${eventId}: ${error?.message ?? 'unknown error'}. Stripe will retry automatically; if it keeps failing, fix the tier manually in Supabase.`,
  )
  return NextResponse.json({ error: 'write failed, will retry' }, { status: 500 })
}

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

/** Resolve a Supabase auth user_id from an email. Used as a LAST-RESORT link
 *  when a subscription/checkout carries no user_id metadata and we have no
 *  stripe_customer_id on file yet (e.g. a subscription created via a Stripe
 *  Payment Link, the Stripe dashboard, or a coupon link rather than MVP's own
 *  checkout). Paginates auth.users; bounded so it can't run away. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findUserIdByEmail(admin: any, email: string | null | undefined): Promise<string | null> {
  const normalized = (email || '').trim().toLowerCase()
  if (!normalized) return null
  const PAGE_SIZE = 1000
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.auth.admin as any).listUsers({ page, perPage: PAGE_SIZE })
    if (error || !data?.users) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hit = data.users.find((u: any) => (u.email ?? '').toLowerCase() === normalized)
    if (hit) return hit.id as string
    if (data.users.length < PAGE_SIZE) break
  }
  return null
}

/** The email on a Stripe customer (for the email fallback above). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stripeCustomerEmail(stripe: any, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null
  try {
    const c = await stripe.customers.retrieve(customerId)
    if (c && !c.deleted) return (c.email as string | null) || null
  } catch { /* customer gone / API error — caller falls through */ }
  return null
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

  // ── Idempotency gate (2026-06-02 audit fix) ──────────────────────────────
  // Stripe retries every webhook on 5xx (up to 3 days) and you can
  // manually replay any event from the dashboard. Without dedup, a
  // replayed `customer.subscription.deleted` after the user re-
  // subscribes would re-downgrade their NEW subscription. Same risk
  // for any other event type — replay during a partial outage can
  // produce out-of-order tier flips.
  //
  // The first INSERT for a given event_id wins; the second hits the
  // PK conflict and returns no rows. We dispatch on that signal: no
  // rows = duplicate = return 200 without doing any work.
  // Cast at the boundary — Supabase types haven't been regenerated
  // since migration 086 was added (TODO: regenerate via
  // `npx supabase gen types` after applying the migration).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed } = await (admin as any)
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, event_type: event.type })
    .select('event_id')
    .maybeSingle()
  if (!claimed) {
    // Already processed (or a concurrent retry won the race).
    // Returning 200 tells Stripe "thanks, got it" and stops the retry
    // loop — exactly what we want.
    return NextResponse.json({ ok: true, duplicate: true, event_id: event.id })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as unknown as {
      metadata: { user_id: string; tier: Tier }
      customer: string
      subscription: string
      // Stripe sets these when line items resolve; we use the price
      // id from here as the SOURCE OF TRUTH for the tier (rather than
      // trusting metadata.tier, which is attacker-influenceable if
      // anyone ever creates a session via the API with a mismatched
      // price + metadata.tier pair). Discovered in the 2026-06-02
      // audit — was a P1 trust-the-client bug.
      line_items?: { data?: { price?: { id?: string } }[] }
      customer_email?: string | null
      customer_details?: { email?: string | null }
    }
    // Derive tier from the actual priceId — never trust metadata.tier
    // for paid status. Fall back to metadata.tier only if Stripe
    // somehow doesn't expand line_items (shouldn't happen in webhook
    // payloads, but defensive).
    const priceId = session.line_items?.data?.[0]?.price?.id
    const tier: Tier = (priceId && PRICE_TO_TIER[priceId]) || session.metadata?.tier
    // Runtime guard (TS types tier as Tier, but a Payment-Link session can have
    // empty metadata AND an unmapped price → undefined at runtime). Never write a
    // blank tier; alert so the price→tier env mapping gets fixed.
    if (!tier) {
      console.warn('[stripe-webhook] checkout.session.completed with no resolvable tier', { priceId, customer: session.customer })
      await alertOps('Stripe checkout completed but tier could not be resolved', `customer ${session.customer}, price ${priceId} not in STRIPE_PRICE_* env map. Set their tier manually in /admin/users and add the price ID to the env mapping.`)
      return NextResponse.json({ received: true, unresolvedTier: true })
    }
    // Resolve the user: metadata (MVP checkout) → else the checkout's email
    // (Payment Link / dashboard-created session that carries no user_id).
    let user_id = session.metadata?.user_id || null
    if (!user_id) {
      user_id = await findUserIdByEmail(admin, session.customer_details?.email || session.customer_email)
        || await findUserIdByEmail(admin, await stripeCustomerEmail(stripe, session.customer))
    }
    if (!user_id) {
      console.warn('[stripe-webhook] checkout.session.completed with no resolvable user', { customer: session.customer, priceId })
      await alertOps('Stripe checkout completed but no MVP user matched', `customer ${session.customer}, price ${priceId}. Set their tier manually in /admin/users.`)
      return NextResponse.json({ received: true, unmatched: true })
    }
    const { error } = await admin.from('integrations').upsert(
      {
        user_id,
        tier,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_status: 'active',
      },
      { onConflict: 'user_id' },
    )
    if (error) return releaseAndRetry(admin, event.id, 'checkout.session.completed', error)
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
    // Resolve the user: metadata (MVP checkout) → else the Stripe customer's
    // email. The email path links subscriptions created OUTSIDE MVP's checkout
    // (Payment Link, dashboard, coupon link) where there's no user_id metadata
    // AND the user has no stripe_customer_id on file yet — previously these
    // matched 0 rows and the paid tier silently never applied.
    let userId = sub.metadata?.user_id || null
    if (tier && !userId) {
      userId = await findUserIdByEmail(admin, await stripeCustomerEmail(stripe, sub.customer))
    }
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
      const { error } = userId
        ? await admin.from('integrations').upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' })
        : await admin.from('integrations').update(fields).eq('stripe_customer_id', sub.customer)
      if (error) return releaseAndRetry(admin, event.id, event.type, error)
    } else {
      console.warn('[stripe-webhook] subscription event with no resolvable tier', { priceId, subId: sub.id, hasMetaTier: !!sub.metadata?.tier })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string; customer: string }
    // Downgrade to the free Trial when subscription cancelled.
    //
    // BUG FIX (2026-06-02 audit): previously matched on customer id
    // alone — `eq('stripe_customer_id', sub.customer)`. That's racy:
    // if a user churns + comes back with a NEW subscription (and the
    // OLD subscription's .deleted event arrives late or is replayed),
    // we'd flip their NEW subscription to trial because the customer
    // id is the same. Now we ALSO require the subscription id to
    // match the row's current `stripe_subscription_id` — so a stale
    // delete for an old subscription is harmless.
    const { error } = await admin.from('integrations')
      .update({
        tier: 'trial',
        stripe_subscription_id: null,
        subscription_status: 'canceled',
        subscription_period_start: null,
        subscription_period_end: null,
      })
      .eq('stripe_customer_id', sub.customer)
      .eq('stripe_subscription_id', sub.id)
    if (error) return releaseAndRetry(admin, event.id, 'customer.subscription.deleted', error)
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as { customer: string }
    // Mark as past_due so the UI can show a warning. We do NOT downgrade
    // immediately — Stripe will retry per the dunning settings, and emit
    // customer.subscription.deleted if it eventually gives up.
    const { error } = await admin.from('integrations')
      .update({ subscription_status: 'past_due' })
      .eq('stripe_customer_id', invoice.customer)
    if (error) return releaseAndRetry(admin, event.id, 'invoice.payment_failed', error)
  }

  return NextResponse.json({ received: true })
}
