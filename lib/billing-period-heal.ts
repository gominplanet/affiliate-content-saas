// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BILLING MONTH IS THE ONE STRIPE BILLS (Seb, 2026-10-28, Douglas). Douglas
// paid $199 on October 27 for a new subscription after his old one ended for
// non-payment. His account kept the paid tier but no billing period, and with
// no period every allowance falls back to the calendar month (lib/tier
// billingWindow): his usage bar counted from October 1 and said "resets Nov 1",
// so the month he had just paid for started already 96 generations in.
//
// The period is written by the Stripe webhook, and any one missed or failed
// event leaves it blank or out of date. So when a paid account has no period,
// or one that ended hours ago, MVP reads the live subscription from Stripe and
// writes its period back: by the subscription on file, else every
// subscription of the customer on file, else of any Stripe customer with the
// member's email (a returning member's checkout makes a new Stripe customer).
// Only the period, the ids and the status are written, never the tier. An
// account with no live subscription (a plan granted by hand) keeps the
// calendar month, which is right for it.

/** Subscription statuses that are still billing the member. */
export const LIVE_SUB_STATUSES = ['active', 'trialing', 'past_due'] as const
/** A period end this long past is a renewal MVP never heard about. */
export const PERIOD_GRACE_MS = 2 * 60 * 60 * 1000
/** One Stripe look per account this often, per server, at most. */
export const HEAL_RETRY_MS = 10 * 60 * 1000

type Row = {
  tier?: string | null
  subscription_period_start?: string | null
  subscription_period_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}

/** Why this account's billing period needs reading from Stripe, or null when
 *  it does not (no paid tier, or a period that is still current). Pure. */
export function needsPeriodHeal(row: Row | null | undefined, now: number = Date.now()): 'missing' | 'ended' | null {
  const tier = String(row?.tier || '')
  if (!tier || tier === 'trial' || tier === 'admin') return null
  if (!row?.subscription_period_start) return 'missing'
  const end = Date.parse(String(row.subscription_period_end || ''))
  if (Number.isFinite(end) && end + PERIOD_GRACE_MS < now) return 'ended'
  return null
}

type SubLike = {
  id: string
  status: string
  created?: number | null
  customer?: unknown
  cancel_at_period_end?: boolean | null
  current_period_start?: number | null
  current_period_end?: number | null
  items?: { data?: { current_period_start?: number | null; current_period_end?: number | null }[] }
}

/** The subscription's current period, from its item (newer API versions) or
 *  itself (older ones), as ISO strings. Pure. */
export function periodOf(sub: SubLike | null | undefined): { start: string; end: string | null } | null {
  if (!sub) return null
  const s = sub.items?.data?.[0]?.current_period_start ?? sub.current_period_start
  const e = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end
  if (typeof s !== 'number' || !s) return null
  return { start: new Date(s * 1000).toISOString(), end: typeof e === 'number' && e ? new Date(e * 1000).toISOString() : null }
}

/** The newest subscription still billing the member, or null. Pure. */
export function pickLiveSub<T extends SubLike>(subs: T[]): T | null {
  const live = subs.filter((s) => (LIVE_SUB_STATUSES as readonly string[]).includes(s.status) && periodOf(s))
  live.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  return live[0] ?? null
}

const customerOf = (sub: SubLike): string | null =>
  typeof sub.customer === 'string' ? sub.customer : (sub.customer as { id?: string } | null)?.id ?? null

const lastTry = new Map<string, number>()

export type HealedPeriod = { start: string; end: string | null; subscriptionId: string; why: 'missing' | 'ended' }

/**
 * Reads the account's live subscription from Stripe and writes its period
 * back, when needsPeriodHeal says so. Returns the period written, or null
 * when nothing was needed, nothing live was found, or Stripe could not be
 * read. Never throws: the caller keeps the window it already had.
 */
export async function healBillingPeriod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stripe: any,
  o: { userId: string; email: string | null | undefined; row: Row | null | undefined; now?: number },
): Promise<HealedPeriod | null> {
  const now = o.now ?? Date.now()
  const why = needsPeriodHeal(o.row, now)
  if (!why) return null
  if (now - (lastTry.get(o.userId) ?? 0) < HEAL_RETRY_MS) return null
  lastTry.set(o.userId, now)
  try {
    let sub: SubLike | null = null
    let unread = 0
    const onFile = o.row?.stripe_subscription_id
    if (onFile) {
      try {
        const s = await stripe.subscriptions.retrieve(onFile)
        if (pickLiveSub([s])) sub = s
      } catch { unread++ /* gone or unreadable: look by customer below */ }
    }
    if (!sub) {
      const customers = new Set<string>()
      if (o.row?.stripe_customer_id) customers.add(o.row.stripe_customer_id)
      const email = String(o.email || '').trim()
      if (email) {
        try {
          const found = await stripe.customers.list({ email, limit: 10 })
          for (const c of found?.data ?? []) if (c?.id) customers.add(c.id)
        } catch { unread++ /* the customer on file is still looked at */ }
      }
      const all: SubLike[] = []
      for (const customer of customers) {
        try {
          const res = await stripe.subscriptions.list({ customer, status: 'all', limit: 10 })
          all.push(...(res?.data ?? []))
        } catch { unread++ /* next customer */ }
      }
      sub = pickLiveSub(all)
    }
    const period = periodOf(sub)
    if (!sub || !period) {
      console.warn(unread
        ? '[billing-period] no live subscription found and some Stripe reads failed; calendar month kept for now'
        : '[billing-period] paid account with no live Stripe subscription; calendar month kept', { userId: o.userId, why, unread })
      return null
    }
    const customer = customerOf(sub)
    const { error } = await admin.from('integrations').update({
      subscription_period_start: period.start,
      subscription_period_end: period.end,
      stripe_subscription_id: sub.id,
      ...(customer ? { stripe_customer_id: customer } : {}),
      subscription_status: sub.cancel_at_period_end ? 'canceling' : sub.status,
    }).eq('user_id', o.userId)
    if (error) {
      console.warn('[billing-period] period read from Stripe but not saved', { userId: o.userId, error: error.message })
      return null
    }
    console.info('[billing-period] billing period restored from Stripe', { userId: o.userId, why, subscription: sub.id, start: period.start, end: period.end })
    return { ...period, subscriptionId: sub.id, why }
  } catch (e) {
    console.warn('[billing-period] Stripe could not be read', { userId: o.userId, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
