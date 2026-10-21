// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEVEN DAYS FREE, THEN THE CARD IS CHARGED (lib/trial, Seb 2026-10-21).
//
// Two things here cost real money if they rot. A member who churns and comes
// back must not get a second free week. And the free week must be set in this
// repo rather than on a Stripe Price, because a trial configured in a
// dashboard is invisible to review and nobody finds out it changed.
import { readFileSync } from 'node:fs'
import { TRIAL_DAYS, trialEligible, trialPeriodDays, trialLabel, trialSentence, TRIAL_SHORT, TRIAL_ALLOWANCE_NOTE } from '../lib/trial'
import { GUARANTEE_DAYS } from '../lib/guarantee'
import { PRICES_BEFORE, NEW_MEMBER_PRICES, PRICE_CHANGE_AT } from '../lib/price-schedule'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')

// ── The offer ────────────────────────────────────────────────────────────────
check('the free week is a week', TRIAL_DAYS === 7)
// The quarter-allowance window (lib/intro-allowance) is what stops somebody
// spending a month of AI inside the free week, so it has to cover it exactly.
check('the quarter-allowance window covers the whole free week', GUARANTEE_DAYS === TRIAL_DAYS)

// ── ONCE PER CUSTOMER ────────────────────────────────────────────────────────
check('a brand new member gets the free week', trialEligible({}) === true
  && trialEligible({ stripeCustomerId: null, subscribedAt: null }) === true)
check('somebody who has been a Stripe customer does not', trialEligible({ stripeCustomerId: 'cus_123' }) === false)
check('somebody whose subscription start was recorded does not', trialEligible({ subscribedAt: '2026-06-21T00:00:00Z' }) === false)
check('and neither does somebody with both', trialEligible({ stripeCustomerId: 'cus_123', subscribedAt: '2026-06-21T00:00:00Z' }) === false)

// STRIPE READS 0 AS A NUMBER IT MAY STILL ACT ON. An absent field is the
// unambiguous way to say "charge them now", so an ineligible member must get
// undefined rather than 0.
check('an ineligible member sends no trial field at all, not a zero',
  trialPeriodDays({ stripeCustomerId: 'cus_123' }) === undefined)
check('an eligible member sends the real number', trialPeriodDays({}) === TRIAL_DAYS)

// ── It is set here, not in a dashboard ───────────────────────────────────────
const CO = read('app/api/stripe/checkout/route.ts')
check('checkout sends the trial length', /trial_period_days: trialDays/.test(CO))
check('and takes it from the policy rather than typing a number',
  /trialPeriodDays\(\{/.test(CO) && !/trial_period_days: 7/.test(CO))
check('checkout reads what decides eligibility', /\.select\('stripe_customer_id,subscribed_at'\)/.test(CO))
check('the field is left out entirely when there is no trial', /\.\.\.\(trialDays \? \{ trial_period_days: trialDays \} : \{\}\)/.test(CO))

// ── A trialing subscription is a paying member as far as access goes ─────────
// Stripe sends status 'trialing' for the free week. If the webhook treated it
// as unpaid, somebody would start their trial and get nothing.
const WH = read('app/api/stripe/webhook/route.ts')
const unpaid = WH.match(/const UNPAID = new Set\(\[([^\]]*)\]\)/)
check('the webhook does not count a trial as unpaid', !!unpaid && !/trialing/.test(unpaid[1]), unpaid?.[1])

// ── What a visitor reads ─────────────────────────────────────────────────────
// No screen may type a price we charge (scripts/test-price-claims), so the
// copy has to come from lib/price-schedule and follow the January change.
const before = Date.parse(PRICE_CHANGE_AT) - 86_400_000
const after = Date.parse(PRICE_CHANGE_AT) + 86_400_000
check('the label quotes the price in force now', trialLabel(before).includes(`$${PRICES_BEFORE.pro.month}`))
check('and follows the January change by itself', trialLabel(after).includes(`$${NEW_MEMBER_PRICES.pro.month}`))
check('the label says free and says how long', /7 days free/.test(trialLabel(before)))
// A trial that surprises somebody on day 8 is a chargeback, not a customer.
check('the sentence says the card is taken now', /card is saved now/.test(trialSentence(before)))
check('the sentence names the day the charge lands', /On day 8/.test(trialSentence(before)))
check('and says cancelling before then costs nothing', /Cancel any time before then and you pay nothing/.test(trialSentence(before)))
check('the short form is usable on a badge', TRIAL_SHORT === '7 days free')
// Everything is open in the free week but at a quarter of each allowance.
// Saying so costs a line and saves the person who hits a cap on day three.
check('the allowance note is honest about the quarter', /quarter of each monthly allowance/.test(TRIAL_ALLOWANCE_NOTE)
  && /Everything is unlocked/.test(TRIAL_ALLOWANCE_NOTE))
check('no price is typed into the trial copy', !/\$199|\$299|\$1,?999|\$2,?990/.test(read('lib/trial.ts')))

// ── NO PAGE PROMISES AN ACCOUNT WITH NO CARD ────────────────────────────────
//
// This is the rule the whole free-tier mess broke. Until 2026-10-21 four
// buttons on /amazon-influencer, three lines on /run-your-storefront and four
// on /join/amazon promised a free account with no card. All of them were
// false, in two layers:
//
//   - the free tier's own window has been ZERO DAYS since NO_TRIAL_FROM, so
//     the account had nothing in it to spend, and
//   - SignupForm defaults any unrecognised tier to 'pro', so the screen behind
//     the "no card" button read "Continue to payment".
//
// A visitor could not have discovered either without clicking. What makes the
// honest version possible is the free week on the paid plan, so this check
// holds every public page to it: say the week, never say "no card".
/**
 * The page with its comments taken out.
 *
 * A comment that QUOTES the old false promise, to explain why it is gone, is
 * the opposite of a false promise, and the first run of this check failed on
 * exactly that: the note on /join/amazon saying 'This read "no card"'. Strip
 * block comments first, which covers JSX's {\/* ... *\/} too, then whole-line
 * // comments. Only ever used for negative matches, so a mangled URL inside a
 * string cannot turn a pass into a failure.
 */
function rendered(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const PUBLIC_PAGES = [
  'app/page.tsx',
  'app/pricing/page.tsx',
  'app/amazon-influencer/page.tsx',
  'app/run-your-storefront/page.tsx',
  'app/join/amazon/page.tsx',
  'app/own-your-blog/page.tsx',
  'app/partner/page.tsx',
]
for (const f of PUBLIC_PAGES) {
  const src = rendered(f)
  check(`${f} does not promise an account with no card`,
    !/\bno card\b/i.test(src),
    'the next screen asks for one')
  // The dead free tier's own CTA. CheckoutButton's tier="trial" branch skips
  // checkout entirely, which is how the promise and the payment screen came
  // apart in the first place.
  check(`${f} does not send anyone to the dead free tier`,
    !/tier="trial"/.test(src),
    'its window has been zero days since NO_TRIAL_FROM')
}

// And the two pages the ads land on have to NAME the week, not merely stop
// lying about the card. A page that says nothing about the trial sells $199 up
// front, which is the conversion problem the trial exists to fix.
for (const f of ['app/page.tsx', 'app/pricing/page.tsx', 'app/amazon-influencer/page.tsx', 'app/join/amazon/page.tsx', 'app/run-your-storefront/page.tsx']) {
  check(`${f} sells the free week from lib/trial`,
    /from '@\/lib\/trial'/.test(read(f)),
    'typed anywhere else, the page and Stripe can disagree on its length')
}

// THE REFUND IS THE BACKSTOP, NOT THE OFFER, and it must still exist. Deleting
// it in the trial's name would leave the member who forgets to cancel on day 8
// with nothing, which is the one person this whole structure is for.
const G = read('lib/guarantee.ts')
check('the refund survives behind the trial', /GUARANTEE_DAYS = 7/.test(G))
check('and lib/guarantee says why it is still here', /backstop/i.test(G))

// CLAUDE.md IS WHAT STOPS THE NEXT SESSION REVERTING THIS. The no-trial rule
// lived there, so copy saying "7 days free" read as a bug to every future
// session and to the nightly audit.
const RULES = read('CLAUDE.md')
check('the working agreements describe the trial', /7-day free trial of Pro/.test(RULES))
check('and still forbid promising a free account with no card', /no card/.test(RULES))

// ── House style ──────────────────────────────────────────────────────────────
const copy = [trialLabel(before), trialSentence(before), TRIAL_SHORT, TRIAL_ALLOWANCE_NOTE].join(' ')
check('no dashes as punctuation in anything a visitor reads', !/[–—]| - /.test(copy))
check('no year typed into the copy', !/\b20\d\d\b/.test(copy))

if (fails.length) {
  console.error(`\n❌ trial: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trial: seven days free, set in this repo rather than a dashboard, once per customer, and the copy says when the card is charged')
