// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BILLING MONTH IS THE ONE STRIPE BILLS (Seb, 2026-10-28, Douglas: paid
// on October 27, his usage bar counted from October 1 and said "resets Nov
// 1"). Pinned: a paid account with no period, or one long ended, reads its
// live subscription from Stripe and writes the period back; checkout and
// every paid invoice write the period too; a returning member keeps the
// first start date, so a new subscription never puts them on quarter
// allowances.
import { readFileSync } from 'node:fs'
import { needsPeriodHeal, periodOf, pickLiveSub, healBillingPeriod } from '../lib/billing-period-heal'
import { billingWindow } from '../lib/tier'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const now = Date.parse('2026-10-28T12:00:00Z')
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000)

check('a paid account with no period is read from Stripe', needsPeriodHeal({ tier: 'pro', subscription_period_start: null }, now) === 'missing')
check('a period that ended hours ago is read again', needsPeriodHeal({ tier: 'pro', subscription_period_start: '2026-09-27T00:00:00Z', subscription_period_end: '2026-10-27T00:00:00Z' }, now) === 'ended')
check('a current period, the trial and admin are left alone', needsPeriodHeal({ tier: 'pro', subscription_period_start: '2026-10-27T00:00:00Z', subscription_period_end: '2026-11-27T00:00:00Z' }, now) === null
  && needsPeriodHeal({ tier: 'trial' }, now) === null && needsPeriodHeal({ tier: 'admin' }, now) === null && needsPeriodHeal(null, now) === null)
check('a period just past its end waits for the renewal event', needsPeriodHeal({ tier: 'pro', subscription_period_start: '2026-09-28T00:00:00Z', subscription_period_end: '2026-10-28T11:00:00Z' }, now) === null)

const item = { id: 'sub_new', status: 'active', created: sec('2026-10-27T15:00:00Z'), customer: 'cus_new', items: { data: [{ current_period_start: sec('2026-10-27T15:00:00Z'), current_period_end: sec('2026-11-27T15:00:00Z') }] } }
const old = { id: 'sub_old', status: 'canceled', created: sec('2026-09-27T00:00:00Z'), customer: 'cus_old', current_period_start: sec('2026-09-27T00:00:00Z'), current_period_end: sec('2026-10-27T00:00:00Z') }
check('the period is read from the item, or the subscription on older payloads', periodOf(item)?.start === '2026-10-27T15:00:00.000Z' && periodOf(item)?.end === '2026-11-27T15:00:00.000Z' && periodOf(old)?.start === '2026-09-27T00:00:00.000Z' && periodOf({ id: 'x', status: 'active' }) === null)
check('the newest live subscription wins, an ended one never does', pickLiveSub([old, item])?.id === 'sub_new' && pickLiveSub([old]) === null
  && pickLiveSub([{ ...item, id: 'a', created: 1 }, { ...item, id: 'b', created: 2 }])?.id === 'b')
const w = billingWindow({ periodStart: periodOf(item)!.start, periodEnd: periodOf(item)!.end, now: new Date(now) })
check('with the period back, the month counts from the day paid', w.startISO === '2026-10-27T15:00:00.000Z' && w.resetLabel === 'Nov 27')

// A returning member: the customer on file is the old one, the new checkout
// made a new Stripe customer with the same email.
async function run() {
  const writes: Record<string, unknown>[] = []
  const admin = { from: () => ({ update: (f: Record<string, unknown>) => { writes.push(f); return { eq: async () => ({ error: null }) } } }) }
  const stripe = {
    subscriptions: {
      retrieve: async () => old,
      list: async ({ customer }: { customer: string }) => ({ data: customer === 'cus_new' ? [item] : [old] }),
    },
    customers: { list: async ({ email }: { email: string }) => ({ data: email === 'douglas@example.com' ? [{ id: 'cus_new' }] : [] }) },
  }
  const row = { tier: 'pro', subscription_period_start: null, stripe_customer_id: 'cus_old', stripe_subscription_id: 'sub_old' }
  const healed = await healBillingPeriod(admin, stripe, { userId: 'u1', email: 'douglas@example.com', row, now })
  check('a returning member\'s new subscription is found by email and its month written', healed?.start === '2026-10-27T15:00:00.000Z' && healed?.subscriptionId === 'sub_new'
    && writes.length === 1 && writes[0].subscription_period_start === '2026-10-27T15:00:00.000Z' && writes[0].stripe_subscription_id === 'sub_new' && writes[0].stripe_customer_id === 'cus_new' && writes[0].subscription_status === 'active' && !('tier' in writes[0]))
  check('Stripe is asked once per account at a time, not on every page', (await healBillingPeriod(admin, stripe, { userId: 'u1', email: 'douglas@example.com', row, now: now + 1000 })) === null && writes.length === 1)
  const none = await healBillingPeriod(admin, { subscriptions: { retrieve: async () => { throw new Error('gone') }, list: async () => ({ data: [old] }) }, customers: { list: async () => ({ data: [] }) } }, { userId: 'u2', email: 'x@example.com', row, now })
  check('a paid tier with nothing live in Stripe keeps the calendar month and writes nothing', none === null && writes.length === 1)
  const down = await healBillingPeriod(admin, { subscriptions: { retrieve: async () => { throw new Error('down') }, list: async () => { throw new Error('down') } }, customers: { list: async () => { throw new Error('down') } } }, { userId: 'u3', email: 'x@example.com', row, now })
  check('Stripe being down never throws', down === null)

  const S = read('app/api/usage/summary/route.ts')
  check('the usage bar repairs the period before counting', /if \(needsPeriodHeal\(ig\)\) \{/.test(S) && /healBillingPeriod\(admin, getStripe\(\), \{ userId: user\.id, email: user\.email, row: ig \}\)/.test(S)
    && /const \{ startISO, resetLabel \} = billingWindow\(\{ periodStart, periodEnd \}\)/.test(S) && S.indexOf('needsPeriodHeal(ig)') < S.indexOf('billingWindow({ periodStart, periodEnd })'))
  const W = read('app/api/stripe/webhook/route.ts')
  check('checkout writes the billing month', /\.\.\.\(week\.period \? \{ subscription_period_start: week\.period\.start, subscription_period_end: week\.period\.end \} : \{\}\)/.test(W) && /period = periodOf\(ended as any\) \?\? period/.test(W))
  check('every paid invoice writes the billing month', /paidPeriod = periodOf\(s as any\)/.test(W) && /\.\.\.\(paidPeriod \? \{ subscription_period_start: paidPeriod\.start, subscription_period_end: paidPeriod\.end \} : \{\}\)/.test(W))
  check('a returning member keeps the first start date', /if \(Number\.isFinite\(had\) && had <= secs \* 1000\) return/.test(W))

  if (fails.length) { console.error('FAIL billing period:\n  ' + fails.join('\n  ')); process.exit(1) }
  console.log('billing period: ok')
}
void run()
