// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PROMISE ON A SALES PAGE IS IN THE TERMS, AND IN CHECKOUT, OR IT IS NOT MADE.
//
// Once, /own-your-blog and /run-your-storefront promised a 30-day money-back
// guarantee five times while section 9 of the Terms said fees were
// non-refundable. Nothing on screen showed it: each page read perfectly on its
// own, and the contradiction only surfaced when somebody asked for their money.
//
// THE PROMISE NOW (Seb, 2026-10-19) is the free week: on the monthly plan the
// card is taken at signup and nothing is charged for 7 days; cancel before
// day 8 and they pay nothing. One per creator. The yearly plan has no free
// week. It replaced the 7-day refund, which members who paid on day one before
// it keep. This guard holds the pages, the Terms, Ask MVP and the checkout
// that makes it true to the same days and the same rules.

import { readFileSync } from 'node:fs'
import { FREE_WEEK_DAYS, FREE_WEEK_FROM, FREE_WEEK_LABEL, FREE_WEEK_SHORT, FREE_WEEK_SENTENCE, LEGACY_REFUND_DAYS, SUPPORT_EMAIL } from '../lib/guarantee'
import { refundCheck } from '../lib/creator-refund'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l)).join('\n')
/** live(), minus the import lines: a guard satisfied by an import checks that
 *  a page still knows the constant exists, which is not the question. */
const body = (src: string) => live(src).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')

const TERMS = body(read('app/terms/page.tsx'))
const SELLING = ['app/own-your-blog/page.tsx', 'app/run-your-storefront/page.tsx', 'app/page.tsx', 'app/pricing/page.tsx']

// ── the constants say it ────────────────────────────────────────────────────
check('the free week is a real number of days', Number.isInteger(FREE_WEEK_DAYS) && FREE_WEEK_DAYS === 7, `got ${FREE_WEEK_DAYS}`)
check('every phrasing carries the number', [FREE_WEEK_LABEL, FREE_WEEK_SHORT, FREE_WEEK_SENTENCE].every((t) => t.includes(String(FREE_WEEK_DAYS))))
check('the label says it is the monthly plan', /monthly plan/.test(FREE_WEEK_LABEL), FREE_WEEK_LABEL)
check('the sentence says the card is charged on day 8, cancelling costs nothing, once per creator, and the yearly plan is charged at once',
  /not charged until day 8/.test(FREE_WEEK_SENTENCE) && /cancel before then you pay nothing/.test(FREE_WEEK_SENTENCE)
    && /One free week per creator/.test(FREE_WEEK_SENTENCE) && /yearly plan is charged when you join/.test(FREE_WEEK_SENTENCE), FREE_WEEK_SENTENCE)
check('no refund is promised to new members any more', !/refund/i.test(FREE_WEEK_LABEL + FREE_WEEK_SHORT + FREE_WEEK_SENTENCE))

// ── the Terms make the same promise ─────────────────────────────────────────
check('the Terms read the days rather than typing them', /FREE_WEEK_DAYS/.test(TERMS) && /from '@\/lib\/guarantee'/.test(read('app/terms/page.tsx')))
check('the Terms say the card is taken and nothing charged for the free week', /The free week on the monthly plan\./.test(TERMS) && /nothing is charged for the first \{FREE_WEEK_DAYS\} days/.test(TERMS.replace(/\s+/g, ' ')))
check('and that cancelling before day 8 costs nothing', /you are never charged/.test(TERMS.replace(/\s+/g, ' ')))
check('and that the yearly plan has no free week', /The yearly plan has no free week/.test(TERMS.replace(/\s+/g, ' ')))
check('and one free week per creator', /One free week per creator\./.test(TERMS))
check('payments are otherwise not refundable, in writing', /Payments are not refundable except where required by law/.test(TERMS.replace(/\s+/g, ' ')))
check('members who joined with the refund keep it, with the inbox', /Members who joined before the free week\./.test(TERMS) && /LEGACY_REFUND_DAYS/.test(TERMS) && /mailto:\$\{SUPPORT_EMAIL\}/.test(TERMS))
check('no refund window is typed by hand in the Terms', !/\b\d+-day refund\b/.test(TERMS))

// ── the pages read it from one place ────────────────────────────────────────
for (const f of SELLING) {
  const src = read(f)
  check(`${f} reads the free week from lib/guarantee`, /from '@\/lib\/guarantee'/.test(src) && /FREE_WEEK_(LABEL|SHORT|SENTENCE|DAYS)/.test(body(src)))
  check(`${f} promises no refund or money back`, !/money.back|\brefund\b|no questions asked/i.test(body(src)), f)
  check(`${f} never says no card is needed`, !/No card to start|no card/i.test(body(src)))
}

// ── checkout makes it true ──────────────────────────────────────────────────
{
  const SIGNUP = read('app/api/auth/signup-paid/route.ts')
  const CHECKOUT = read('app/api/stripe/checkout/route.ts')
  check('a monthly signup gets the free week, a yearly one does not', /const freeWeek = !annualId\n/.test(SIGNUP) && /trial_period_days: FREE_WEEK_DAYS/.test(SIGNUP) && /payment_method_collection: 'always'/.test(SIGNUP))
  check('an account that was a Stripe customer before gets no free week', /const freeWeek = !annualId && !customerId/.test(CHECKOUT) && /trial_period_days: FREE_WEEK_DAYS/.test(CHECKOUT))
  check('a free week without a card ends rather than runs on', (SIGNUP + CHECKOUT).match(/missing_payment_method: 'cancel'/g)?.length === 2)
  const HOOK = read('app/api/stripe/webhook/route.ts')
  check('a card or email that had a free week, or a refund, is charged at once', /priorFreeWeek\(o\.userId/.test(HOOK) && /trial_end: 'now'/.test(HOOK) && /from\('creator_refunds'\)/.test(HOOK))
  check('every free week is recorded so the next can be matched', /from\('creator_trials'\)\.upsert/.test(HOOK))
  check('the status written is the subscription’s own, never an assumed active', /subscription_status: week\.status/.test(HOOK))
  check('a free week is reported as a trial, and the first real charge as the purchase', /eventName: 'StartTrial'/.test(HOOK) && /purchaseAfterFreeWeek\(stripe, subId/.test(HOOK))
  check('migration 444 is safe to run twice', /create table if not exists public\.creator_trials/.test(read('supabase/migrations/444_creator_trials.sql')))
}

// ── one inbox ───────────────────────────────────────────────────────────────
{
  const ASK = read('lib/assistant-features-doc.ts')
  check('the inbox is a real address', /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(SUPPORT_EMAIL), SUPPORT_EMAIL)
  check('Ask MVP gives the free week and the same inbox', /FREE_WEEK_SENTENCE/.test(ASK) && /email \$\{SUPPORT_EMAIL\}/.test(ASK) && /\$\{LEGACY_REFUND_DAYS\}-day/.test(ASK))
  check('Ask MVP never offers a free week on the yearly plan', /Never offer a free plan, any plan other than Pro, or a free week on the yearly plan\./.test(ASK))
  check('no older inbox survives', !/us@gominplanet\.com/.test(read('app/terms/page.tsx') + ASK))
}
check('the legacy refund window is still the 7 days those members joined with', LEGACY_REFUND_DAYS === 7)

// ── the refund is kept by those who joined with it, and only by them ────────
{
  const from = Date.parse(FREE_WEEK_FROM)
  const at = (ms: number) => new Date(ms).toISOString()
  const before = refundCheck({ paidAtISO: at(from - 2 * 864e5), alreadyRefunded: false, matches: [], now: new Date(from) })
  check('a member who paid before the free week still gets the refund in their window', before.eligible, before.reason)
  const after = refundCheck({ paidAtISO: at(from + 864e5), alreadyRefunded: false, matches: [], now: new Date(from + 2 * 864e5) })
  check('a member who paid after the free week began is told no refund was promised', !after.eligible && /replaced the refund/.test(after.reason), after.reason)
}

if (failures.length) {
  console.error(`\n❌ guarantee: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ guarantee: the free week on the sales pages is the one in the Terms and in checkout, monthly only, once per creator')
