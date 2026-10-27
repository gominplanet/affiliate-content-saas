// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PAYMENT THAT DID NOT GO THROUGH IS SAID (Seb, 2026-10-27: "douglas got
// declined payment multiple times it seems and is now back to trial due to
// this"). Pinned: past due says so with Update your card; a plan Stripe ended
// for non-payment says so with Subscribe again; a plan the member cancelled
// says nothing; the webhook keeps the reason.
import { readFileSync } from 'node:fs'
import { billingAlertOf, billingAlertWords, ENDED_UNPAID } from '../lib/billing-alert'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const now = Date.parse('2026-10-27T12:00:00Z')

check('a failing payment is said', billingAlertOf({ status: 'past_due', tier: 'pro' })?.kind === 'past_due' && billingAlertOf({ status: 'unpaid', tier: 'pro' })?.kind === 'past_due')
check('a plan ended for non-payment is said', billingAlertOf({ status: ENDED_UNPAID, tier: 'trial', endedAt: '2026-10-25T19:54:00Z', now })?.kind === 'ended_unpaid')
check('an older ended plan is read from Stripe\'s reason', billingAlertOf({ status: 'canceled', tier: 'trial', endedReason: 'payment_failed', endedAt: '2026-10-25T19:54:00Z', now })?.kind === 'ended_unpaid')
check('a plan the member cancelled says nothing', billingAlertOf({ status: 'canceled', tier: 'trial', endedReason: 'cancellation_requested', now }) === null)
check('an active plan says nothing', billingAlertOf({ status: 'active', tier: 'pro' }) === null && billingAlertOf({ status: 'trialing', tier: 'pro' }) === null)
check('a plan that ended long ago stops being said', billingAlertOf({ status: ENDED_UNPAID, tier: 'trial', endedAt: '2026-06-01T00:00:00Z', now }) === null)
const pd = billingAlertWords({ kind: 'past_due' }), end = billingAlertWords({ kind: 'ended_unpaid', endedAt: '2026-10-25T19:54:00Z' })
check('the words say what happened and what to do, with no dashes', /did not go through/.test(pd.text) && pd.action === 'Update your card' && /ended on .* because your bank declined the card/.test(end.text) && end.action === 'Subscribe again' && ![pd.text, end.text].some((t) => /[–—]| - /.test(t)))

const W = read('app/api/stripe/webhook/route.ts')
check('the webhook keeps why a plan ended', /sub\.cancellation_details\?\.reason === 'payment_failed' \? ENDED_UNPAID : 'canceled'/.test(W) && /subscription_status: endedStatus,/.test(W))
const R = read('app/api/stripe/billing-alert/route.ts')
check('an ended plan with a live one after it says nothing, and Stripe\'s reason is kept once', /if \(subs\.data\.some\(\(s\) => \['active', 'trialing', 'past_due', 'unpaid'\]\.includes\(s\.status\)\)\) return NextResponse\.json\(\{ alert: null \}\)/.test(R) && /update\(\{ subscription_status: ENDED_UNPAID \}\)/.test(R))
const B = read('components/layout/BillingAlert.tsx'), SHELL = read('components/layout/DashboardShellV2.tsx')
check('the banner is on every dashboard page, with the portal for a failing card and Billing for an ended plan', /<BillingAlert \/>/.test(SHELL) && /fetch\('\/api\/stripe\/portal', \{ method: 'POST' \}\)/.test(B) && /href="\/billing"/.test(B))

if (fails.length) { console.error('billing-alert failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ billing-alert: a failing payment and a plan ended for it are said, with what to do; a cancelled plan is not')
