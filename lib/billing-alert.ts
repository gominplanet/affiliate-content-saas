// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PAYMENT THAT DID NOT GO THROUGH IS SAID (Seb, 2026-10-27: "douglas got
// declined payment multiple times it seems and is now back to trial due to
// this"). His bank declined the renewal six times over eight days, Stripe
// gave up and cancelled, and MVP moved him to its no-plan state with nothing
// on screen at any point: the webhook marked him past due "so the UI can show
// a warning", and no screen read it. Now:
//   - past due: a banner says the last payment did not go through, that
//     Stripe tries again and the plan ends if every try fails, with Update
//     your card (Stripe's billing portal);
//   - ended for non-payment: a banner says the plan ended because the card was
//     declined, that everything is still here, with Subscribe again.
// A plan the member cancelled is not this, and says nothing. Pure.

export type BillingAlert = { kind: 'past_due' } | { kind: 'ended_unpaid'; endedAt: string | null }

/** The status MVP keeps for a plan Stripe ended because every payment failed. */
export const ENDED_UNPAID = 'canceled_unpaid'
/** An ended plan is said this long, then the account is simply on no plan. */
export const ENDED_SAID_MS = 60 * 86_400_000

/** What to say, from the account's row (and, for a plan ended before MVP kept
 *  the reason, Stripe's own reason). Pure. */
export function billingAlertOf(o: { status: string | null | undefined; tier: string | null | undefined; endedReason?: string | null; endedAt?: string | null; now?: number }): BillingAlert | null {
  const status = String(o.status || '')
  if (status === 'past_due' || status === 'unpaid') return { kind: 'past_due' }
  const ended = status === ENDED_UNPAID || (status === 'canceled' && o.endedReason === 'payment_failed')
  if (!ended) return null
  const at = Date.parse(String(o.endedAt || ''))
  if (Number.isFinite(at) && (o.now ?? Date.now()) - at > ENDED_SAID_MS) return null
  return { kind: 'ended_unpaid', endedAt: o.endedAt ?? null }
}

/** The banner's words. Pure. */
export function billingAlertWords(a: BillingAlert): { text: string; action: string } {
  if (a.kind === 'past_due') return {
    text: 'Your last MVP payment did not go through: your bank declined the card. Stripe tries again over the next few days, and your plan ends if every try fails. Updating the card now keeps everything running.',
    action: 'Update your card',
  }
  const when = a.endedAt ? ` on ${new Date(a.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''
  return {
    text: `Your MVP plan ended${when} because your bank declined the card and every retry failed. Your posts, links and settings are all still here: subscribe again with a card that works to pick up where you left off.`,
    action: 'Subscribe again',
  }
}
