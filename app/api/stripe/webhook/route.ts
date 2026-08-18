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

// NOTE: no `export const config = { api: { bodyParser: false } }` — that's a
// Pages-Router directive and a no-op in the App Router. The raw body needed for
// signature verification comes from `await request.text()` in POST below.

// $49 Creator price = the existing STRIPE_PRICE_STARTER (renamable via
// STRIPE_PRICE_CREATOR). $99 Studio = STRIPE_PRICE_STUDIO. $199 = Pro.
// When an env var is unset, the resulting `undefined` key would silently mis-
// map a paying customer's webhook to whatever tier shared the empty slot —
// so we filter undefined keys out instead of `process.env.X!`-ing them.
const PRICE_TO_TIER: Record<string, Tier> = Object.fromEntries(
  (
    [
      [process.env.STRIPE_PRICE_CREATOR ?? process.env.STRIPE_PRICE_STARTER, 'creator'],
      [process.env.STRIPE_PRICE_AMAZON, 'amazon'],
      [process.env.STRIPE_PRICE_STUDIO, 'studio'],
      [process.env.STRIPE_PRICE_PRO, 'pro'],
    ] as Array<[string | undefined, Tier]>
  ).filter(([id]) => !!id) as Array<[string, Tier]>,
)

// Sanity floors per paid tier (cents). A price BELOW its tier's floor means a
// paid tier is being granted for far less than intended — the exact failure that
// let a $49 price hand out Pro. Coupons don't matter here: we check the price's
// LIST amount (unit_amount), which discounts never change. Set below the real
// list prices ($49 / $99 / $199) so normal prices never trip it, only a price
// that's cheaper than the tier BENEATH it.
const TIER_MIN_CENTS: Partial<Record<Tier, number>> = { creator: 4000, amazon: 6000, studio: 8000, pro: 15000 }

/** Best-effort alert when a paid tier is granted from a suspiciously cheap price
 *  (e.g. Pro on a $49 price). Never throws — a guard here must not fail the
 *  webhook or block the tier write. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertIfTierPriceTooCheap(stripe: any, tier: Tier, priceId: string | undefined, unitAmount: number | null | undefined, customer: string | null | undefined): Promise<void> {
  try {
    const min = TIER_MIN_CENTS[tier]
    if (!min || !priceId) return
    let amount = unitAmount ?? null
    if (amount == null) { const p = await stripe.prices.retrieve(priceId); amount = p?.unit_amount ?? null }
    if (amount == null || amount >= min) return
    await alertOps(
      `Paid tier "${tier}" granted from a too-cheap price ($${(amount / 100).toFixed(2)})`,
      `Price ${priceId} lists at $${(amount / 100).toFixed(2)}, but "${tier}" expects at least $${(min / 100).toFixed(0)}. This grants ${tier} for less than intended — check STRIPE_PRICE_* in Vercel and the Stripe product prices (a duplicate/mispriced tier). Customer: ${customer || 'unknown'}.`,
    )
  } catch { /* alerting is best-effort */ }
}

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

/**
 * Guard against a REPLAYED or OUT-OF-ORDER subscription event overwriting the
 * row with a subscription that is no longer the current one.
 *
 * Churn-and-return: a user on sub A cancels and resubscribes as sub B. The
 * row now holds B. If Stripe then replays (or delivers late) an `.updated`
 * event for the OLD sub A, the by-user_id upsert would flip the row back to
 * A's tier/period — wrong tier, and it also re-points stripe_subscription_id at
 * A so a later real cancel of B wouldn't match the `.deleted` guard.
 *
 * We compare Stripe's immutable `created` timestamps: the event is STALE only
 * when its subscription was created BEFORE the subscription already on file.
 * Same-sub events (renewals, in-place plan swaps) and first subscriptions are
 * never stale. Fail-OPEN (returns false = apply) on any uncertainty so a real
 * update is never dropped over a transient read error.
 */
async function isStaleSubEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, stripe: any, userId: string, incomingSubId: string | null, incomingCreated: number | null,
): Promise<boolean> {
  try {
    if (!incomingSubId) return false
    const { data: row } = await admin
      .from('integrations').select('stripe_subscription_id').eq('user_id', userId).maybeSingle()
    const currentSubId = (row as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id || null
    // No subscription on file, or the SAME subscription → no conflict, apply.
    if (!currentSubId || currentSubId === incomingSubId) return false
    // A different subscription is on file. Apply only if the incoming one is
    // NEWER (created later). Retrieve the stored sub's created timestamp.
    let storedCreated = 0
    try {
      const s = await stripe.subscriptions.retrieve(currentSubId)
      storedCreated = (s?.created as number) ?? 0
    } catch {
      return false // stored sub is gone/unreadable → treat the incoming as current
    }
    if (!storedCreated || !incomingCreated) return false
    return incomingCreated < storedCreated // stale iff created before the current sub
  } catch {
    return false // never drop a real update over an unexpected error
  }
}

/**
 * Same stale-event guard as isStaleSubEvent, but keyed on the Stripe customer
 * id (used on the fallback branch for subscriptions with no user_id metadata —
 * Payment Link / dashboard / older subs). Without it a replayed or late event
 * for a churn-and-return customer's OLD subscription could overwrite the row
 * that already reflects their NEW one.
 */
async function isStaleSubEventByCustomer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, stripe: any, customerId: string, incomingSubId: string | null, incomingCreated: number | null,
): Promise<boolean> {
  try {
    if (!incomingSubId) return false
    const { data: row } = await admin
      .from('integrations').select('stripe_subscription_id').eq('stripe_customer_id', customerId).maybeSingle()
    const currentSubId = (row as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id || null
    if (!currentSubId || currentSubId === incomingSubId) return false
    let storedCreated = 0
    try {
      const s = await stripe.subscriptions.retrieve(currentSubId)
      storedCreated = (s?.created as number) ?? 0
    } catch {
      return false
    }
    if (!storedCreated || !incomingCreated) return false
    return incomingCreated < storedCreated
  } catch {
    return false
  }
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
  const { data: claimed, error: claimErr } = await (admin as any)
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, event_type: event.type })
    .select('event_id')
    .maybeSingle()
  if (claimErr) {
    // ONLY a unique-violation (23505) means "already claimed" → safe to ack with
    // 200 and stop Stripe's retries. ANY OTHER error (transient DB, pool
    // exhaustion) must NOT be swallowed as a duplicate — returning 200 there
    // would tell Stripe to stop retrying and the tier write would be lost
    // forever. 500 so Stripe redelivers the event.
    if ((claimErr as { code?: string }).code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true, event_id: event.id })
    }
    console.error('[stripe-webhook] claim insert failed (non-duplicate):', claimErr)
    return NextResponse.json({ error: 'claim insert failed' }, { status: 500 })
  }
  if (!claimed) {
    // No error but no row returned — treat as already-claimed (defensive).
    return NextResponse.json({ ok: true, duplicate: true, event_id: event.id })
  }

  // Everything past the claim is wrapped so ANY throw (Stripe API error,
  // unexpected exception) releases the claim and 500s for Stripe to retry —
  // otherwise the event stays claimed-but-unprocessed and the retry is deduped
  // to 200, silently losing the tier write. (A hard function timeout can't run
  // the catch, but MVP's own checkouts carry user_id metadata and skip the
  // expensive email scan that is the only realistic timeout source.)
  try {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as unknown as {
      id: string
      metadata: { user_id: string; tier: Tier }
      customer: string
      subscription: string
      // The price id is the SOURCE OF TRUTH for the tier (rather than
      // trusting metadata.tier, which is attacker-influenceable if
      // anyone ever creates a session via the API with a mismatched
      // price + metadata.tier pair). Discovered in the 2026-06-02 audit.
      line_items?: { data?: { price?: { id?: string } }[] }
      customer_email?: string | null
      customer_details?: { email?: string | null }
    }
    // Derive tier from the ACTUAL priceId — never trust metadata.tier for paid
    // status. IMPORTANT: Stripe does NOT expand `line_items` on the webhook
    // event object (only on a `retrieve({expand})` / `listLineItems` call), so
    // the guard was previously dead — priceId was always undefined and tier
    // fell through to metadata.tier every time. Fetch the line item explicitly
    // so the source-of-truth check actually runs; fall back to metadata.tier
    // only if the fetch fails or the price isn't in our env map.
    let priceId = session.line_items?.data?.[0]?.price?.id
    if (!priceId) {
      try {
        const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 })
        priceId = li.data?.[0]?.price?.id
      } catch (e) {
        console.warn('[stripe-webhook] listLineItems failed; falling back to metadata.tier', e)
      }
    }
    const tier: Tier = (priceId && PRICE_TO_TIER[priceId]) || session.metadata?.tier
    // Runtime guard (TS types tier as Tier, but a Payment-Link session can have
    // empty metadata AND an unmapped price → undefined at runtime). Never write a
    // blank tier; alert so the price→tier env mapping gets fixed.
    if (!tier) {
      console.warn('[stripe-webhook] checkout.session.completed with no resolvable tier', { priceId, customer: session.customer })
      await alertOps('Stripe checkout completed but tier could not be resolved', `customer ${session.customer}, price ${priceId} not in STRIPE_PRICE_* env map. Set their tier manually in /admin/users and add the price ID to the env mapping.`)
      return NextResponse.json({ received: true, unresolvedTier: true })
    }
    // Catch a paid tier granted from a too-cheap price (e.g. Pro on $49). The
    // event doesn't expand line-item amounts, so the helper fetches the price.
    void alertIfTierPriceTooCheap(stripe, tier, priceId, null, session.customer)
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
      created?: number
      customer: string
      items: { data: { price: { id: string; unit_amount?: number | null } }[] }
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
      // Catch a paid tier granted from a too-cheap price (e.g. Pro on $49).
      void alertIfTierPriceTooCheap(stripe, tier, priceId, sub.items.data[0]?.price?.unit_amount, sub.customer)
      const baseFields = {
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

      // Don't RAISE the tier while the subscription's money isn't settled. A
      // failed upgrade proration (proration_behavior 'always_invoice' with a
      // declined card) can leave sub.status='active' but with an OPEN, unpaid
      // invoice — so status alone isn't enough; we check the latest invoice.
      // When unsettled we still record status + period, but leave the tier at
      // whatever's on file (the old, paid-for plan), so nobody gets the higher
      // tier for free during dunning. invoice.payment_succeeded grants the tier
      // the moment the charge clears. Never DOWNGRADES here — only withholds a
      // raise — so a transient past_due on a normal renewal can't strip access.
      const UNPAID = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired'])
      let settled = !UNPAID.has(sub.status)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const latestInvoiceId = (sub as any).latest_invoice
      if (settled && typeof latestInvoiceId === 'string' && latestInvoiceId) {
        try {
          const li = await stripe.invoices.retrieve(latestInvoiceId)
          const owes = (li?.amount_due ?? 0) > 0 && (li?.status === 'open' || li?.status === 'uncollectible')
          if (owes) settled = false
        } catch { /* keep the status-based decision */ }
      }
      // Apply the tier only when settled; otherwise record status + period only.
      const fields = settled ? { ...baseFields, tier } : baseFields

      // If we know the user_id (stamped on the subscription at checkout), upsert
      // by user_id — this links the row + applies the tier even when
      // checkout.session.completed hasn't run yet (no chicken-and-egg on the
      // stripe_customer_id). Otherwise fall back to matching by customer id
      // (renewals / older subscriptions without our metadata).
      if (userId) {
        // Don't let a replayed/out-of-order event for an OLD subscription
        // overwrite the current one (churn-and-return race).
        if (await isStaleSubEvent(admin, stripe, userId, sub.id, sub.created ?? null)) {
          console.warn('[stripe-webhook] ignoring stale/out-of-order subscription event', { incoming: sub.id, userId })
        } else {
          const { error } = await admin.from('integrations').upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' })
          if (error) return releaseAndRetry(admin, event.id, event.type, error)
        }
      } else {
        // Same churn-and-return stale guard, keyed on the customer id (this
        // branch has no user_id metadata). Previously unguarded.
        if (await isStaleSubEventByCustomer(admin, stripe, sub.customer, sub.id, sub.created ?? null)) {
          console.warn('[stripe-webhook] ignoring stale/out-of-order subscription event (by customer)', { incoming: sub.id, customer: sub.customer })
        } else {
          const { error } = await admin.from('integrations').update(fields).eq('stripe_customer_id', sub.customer)
          if (error) return releaseAndRetry(admin, event.id, event.type, error)
        }
      }
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

  // Payment recovered after a failed invoice — clear the past_due flag so the
  // UI stops warning. Only touches rows we actually marked past_due; leaves a
  // 'canceling' or already-active status alone.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as { customer: string; subscription?: string | null }
    const { error } = await admin.from('integrations')
      .update({ subscription_status: 'active' })
      .eq('stripe_customer_id', invoice.customer)
      .eq('subscription_status', 'past_due')
    if (error) return releaseAndRetry(admin, event.id, 'invoice.payment_succeeded', error)

    // Grant the tier the customer is actually paid for now. This lands an
    // upgrade whose proration we WITHHELD until payment cleared (see the unpaid
    // guard on subscription.updated), and self-heals any tier drift. Guarded to
    // the row's CURRENT subscription so a replayed invoice for an old
    // subscription can't overwrite a newer plan. Reads the real price → tier,
    // so it can never grant more than what's paid.
    const subId = invoice.subscription || null
    if (subId) {
      let paidTier: Tier | undefined
      try {
        const s = await stripe.subscriptions.retrieve(subId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pid = (s as any)?.items?.data?.[0]?.price?.id as string | undefined
        paidTier = pid ? PRICE_TO_TIER[pid] : undefined
      } catch { /* leave tier as-is on any lookup failure */ }
      if (paidTier) {
        const { error: tErr } = await admin.from('integrations')
          .update({ tier: paidTier })
          .eq('stripe_customer_id', invoice.customer)
          .eq('stripe_subscription_id', subId)
        if (tErr) return releaseAndRetry(admin, event.id, 'invoice.payment_succeeded', tErr)
      }
    }
  }

  return NextResponse.json({ received: true })
  } catch (err) {
    // A throw after the claim would otherwise leave the event claimed but
    // unprocessed; Stripe's retry would be deduped to 200 and the write lost.
    // Release the claim so the retry re-processes (all writes are idempotent).
    return releaseAndRetry(admin, event.id, event.type, { message: err instanceof Error ? err.message : String(err) })
  }
}
