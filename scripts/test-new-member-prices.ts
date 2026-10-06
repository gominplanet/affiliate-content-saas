// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PRICES GO UP ON NOVEMBER 1, BY DATE, AND EVERYONE WHO JOINS BEFORE KEEPS
// THEIR PRICE FOR GOOD, ON EITHER PLAN. NOBODY IS CHARGED A PRICE THE PAGE DID
// NOT SHOW.
//
// Seb, 2026-10-05: new members pay Amazon $159 and Pro $299 ($1,590 and $2,990
// a year) from November 1. Join before and you keep $99 or $199 for as long as
// you stay subscribed, whatever MVP adds, "whatever tier they take". The sales
// pages count down to it and explain the lock.
//
// Run: npx tsx scripts/test-new-member-prices.ts
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: string) => { if (!ok) failures.push(detail ? `${name}: ${detail}` : name) }
const r = (p: string) => readFileSync(p, 'utf8')

// Ids as they will sit in Vercel: today's prices in the existing vars, the new
// ones in the *_NEW vars.
Object.assign(process.env, {
  STRIPE_PRICE_AMAZON: 'price_amz99,price_amz79', STRIPE_PRICE_AMAZON_ANNUAL: 'price_amz999',
  STRIPE_PRICE_PRO: 'price_pro199', STRIPE_PRICE_PRO_ANNUAL: 'price_pro1999',
  STRIPE_PRICE_AMAZON_NEW: 'price_amz159', STRIPE_PRICE_AMAZON_ANNUAL_NEW: 'price_amz1590',
  STRIPE_PRICE_PRO_NEW: 'price_pro299', STRIPE_PRICE_PRO_ANNUAL_NEW: 'price_pro2990',
})
delete process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES

async function main() {
  const S = await import('../lib/price-schedule')
  const { TIERS } = await import('../lib/tier')
  const ST = await import('../lib/stripe')
  const { shownPriceCents, PRICE_MISMATCH_ERROR } = await import('../lib/price-guard')

  const BEFORE = Date.parse('2026-11-01T06:59:59Z') // 11:59:59 pm Oct 31, Pacific
  const AFTER = Date.parse('2026-11-01T07:00:00Z')  // midnight Nov 1, Pacific
  const realNow = Date.now
  const at = <T>(t: number, f: () => T): T => { Date.now = () => t; try { return f() } finally { Date.now = realNow } }

  // ── the schedule ──────────────────────────────────────────────────────────
  check('the change is midnight November 1, Pacific', S.PRICE_CHANGE_AT === '2026-11-01T07:00:00.000Z')
  check('the prices: $99/$199 before, $159/$299 after, yearly $999/$1,999 then $1,590/$2,990',
    S.PRICES_BEFORE.amazon.month === 99 && S.PRICES_BEFORE.pro.month === 199 && S.PRICES_BEFORE.amazon.year === 999 && S.PRICES_BEFORE.pro.year === 1999
    && S.NEW_MEMBER_PRICES.amazon.month === 159 && S.NEW_MEMBER_PRICES.pro.month === 299 && S.NEW_MEMBER_PRICES.amazon.year === 1590 && S.NEW_MEMBER_PRICES.pro.year === 2990)
  check('a second before, the old prices', !S.newPricesLive(BEFORE) && S.livePrice('amazon', 'month', BEFORE) === 99 && S.livePrice('pro', 'month', BEFORE) === 199)
  check('at the change, the new prices', S.newPricesLive(AFTER) && S.livePrice('amazon', 'month', AFTER) === 159 && S.livePrice('pro', 'year', AFTER) === 2990)
  check('the countdown runs until then and stops at it', S.timeUntilPriceChange(BEFORE)?.seconds === 1 && S.timeUntilPriceChange(AFTER) === null)
  process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES = 'off'
  check("'off' postpones the change and hides the countdown", !S.newPricesLive(AFTER) && S.timeUntilPriceChange(BEFORE) === null)
  process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES = 'on'
  check("'on' starts it early", S.newPricesLive(BEFORE))
  delete process.env.NEXT_PUBLIC_NEW_MEMBER_PRICES

  // ── the page reads the price at the moment it is asked ────────────────────
  check('TIERS shows $99 and $199 before', at(BEFORE, () => TIERS.amazon.price === 99 && TIERS.pro.price === 199 && TIERS.pro.annualPrice === 1999))
  check('and $159 and $299 after, in the same running server', at(AFTER, () => TIERS.amazon.price === 159 && TIERS.pro.price === 299 && TIERS.amazon.annualPrice === 1590))
  check('the guard compares against the same number', at(AFTER, () => shownPriceCents('amazon', 'month') === 15900 && shownPriceCents('pro', 'year') === 299000))
  check('the refusal says what is happening, without dash punctuation', /checkout is paused/.test(PRICE_MISMATCH_ERROR) && !/[—–]| - /.test(PRICE_MISMATCH_ERROR))

  // ── checkout charges new buyers by date ───────────────────────────────────
  check('before: new buyers are charged today’s prices', at(BEFORE, () => ST.PRICE_IDS.amazon === 'price_amz99' && ST.PRICE_IDS.pro === 'price_pro199' && ST.annualPriceIdFor('pro') === 'price_pro1999'))
  check('after: the new prices, with no deploy', at(AFTER, () => ST.PRICE_IDS.amazon === 'price_amz159' && ST.PRICE_IDS.pro === 'price_pro299' && ST.annualPriceIdFor('amazon') === 'price_amz1590'))
  check('the webhook knows every price, old and new, from today',
    ['price_amz99', 'price_amz79', 'price_amz999', 'price_amz159', 'price_amz1590'].every((id) => ST.PRICE_ID_LIST.amazon.includes(id))
    && ['price_pro199', 'price_pro1999', 'price_pro299', 'price_pro2990'].every((id) => ST.PRICE_ID_LIST.pro.includes(id)))

  // ── the lock: whoever joined before keeps that price level on either plan ──
  check('an early Amazon member moving to Pro after the change pays $199, not $299',
    at(AFTER, () => ST.planChangePriceId('pro', 'month', 'price_amz99') === 'price_pro199'))
  check('an early Pro member moving to Amazon pays $99, not $159',
    at(AFTER, () => ST.planChangePriceId('amazon', 'month', 'price_pro199') === 'price_amz99'))
  check('yearly too', at(AFTER, () => ST.planChangePriceId('pro', 'year', 'price_amz999') === 'price_pro1999'))
  check('a member who joined after the change moves at the new prices',
    at(AFTER, () => ST.planChangePriceId('pro', 'month', 'price_amz159') === 'price_pro299'))
  check('the lock is told apart from the new prices', ST.isLockedInPrice('price_amz79') && !ST.isLockedInPrice('price_pro299') && !ST.isLockedInPrice(null))

  const CO = r('app/api/stripe/checkout/route.ts')
  check('checkout uses the locked price for every plan change',
    /const changePriceId = planChangePriceId\(tier, annualId \? 'year' : 'month', item\.price\?\.id\) \?\? priceId/.test(CO)
    && /items: \[\{ id: item\.id, price: changePriceId \}\]/.test(CO) && /items: \[\{ price: changePriceId, quantity: 1 \}\]/.test(CO)
    && !/items: \[\{ id: item\.id, price: priceId \}\]/.test(CO))
  const PU = r('app/api/stripe/preview-upgrade/route.ts')
  check('and the upgrade preview quotes that same price', /planChangePriceId\(/.test(PU) && /items: \[\{ id: item\.id, price: changePriceId \}\]/.test(PU))
  const guardAt = CO.indexOf("await priceMismatch(stripe, priceId, tier as Tier, annualId ? 'year' : 'month', 'checkout')")
  check('checkout compares the Stripe price with the shown one before it changes anything',
    guardAt > 0 && guardAt < CO.indexOf('stripe.subscriptions.update(') && guardAt < CO.indexOf('stripe.checkout.sessions.create('))
  const SP = r('app/api/auth/signup-paid/route.ts')
  // Was pinned to 'month'. Paid signup now honours ?billing=annual (it used to
  // check out a yearly buyer monthly), so it compares at the interval it bills.
  const spAt = SP.indexOf("await priceMismatch(getStripe(), priceId, tier as Tier, annualId ? 'year' : 'month', 'paid signup')")
  check('paid signup checks it before the account is created', spAt > 0 && spAt < SP.indexOf('admin.auth.admin.createUser('))
  check('re-selecting your own plan keeps the price you pay',
    /\(sameInterval && !!item\.price\?\.id && tierIds\.includes\(item\.price\.id\)\)/.test(CO))

  // ── the member sees what they pay ─────────────────────────────────────────
  const PS = r('app/api/stripe/plan-status/route.ts')
  check('plan-status reports the live price and whether it is locked in', /lockedIn: isLockedInPrice\(livePrice\.id\)/.test(PS))
  const BP = r('app/(dashboard)/billing/page.tsx')
  check('billing shows that amount', /paying \? ` · \$\$\{paying\.amountUsd\.toLocaleString\('en-US'\)\}\/\$\{paying\.interval\}` : ''/.test(BP))
  check('and a locked-in member’s plan picker shows their locked prices', /price: paying\?\.lockedIn && \(t === 'amazon' \|\| t === 'pro'\) \? PRICES_BEFORE\[t\]\.month : TIERS\[t\]\.price/.test(BP))

  // ── the sales pages count down and explain the lock ───────────────────────
  const C = r('components/landing/PriceLockCountdown.tsx')
  const jsx = C.slice(C.indexOf('  return ('))
  check('the countdown reads its numbers from the schedule', /\$\{PRICES_BEFORE\.amazon\.month\}/.test(C) && /\$\{NEW_MEMBER_PRICES\.pro\.month\}/.test(C) && /timeUntilPriceChange\(\)/.test(C))
  check('it explains the lock in plain words', /locked for as long as you stay subscribed/.test(C) && /Every feature we add is included at that price/.test(C) && /stays yours if you switch plans/.test(C))
  check('it names no year and no dash punctuation', !/20\d\d/.test(jsx) && !/[—–]| - /.test(jsx))
  check('it disappears once the change happens', /if \(over\) return null/.test(C))
  for (const p of ['app/page.tsx', 'app/pricing/page.tsx', 'app/amazon-influencer/page.tsx', 'app/run-your-storefront/page.tsx']) {
    check(`${p} shows the countdown`, /<PriceLockCountdown /.test(r(p)))
  }
  // own-your-blog added: it prints both prices through AdPricingTable and was fully static.
  for (const p of ['app/page.tsx', 'app/amazon-influencer/page.tsx', 'app/run-your-storefront/page.tsx', 'app/own-your-blog/page.tsx']) {
    check(`${p} re-renders on its own, so the new price shows without a deploy`, /export const revalidate = 600/.test(r(p)))
  }

  // ── static copy cannot follow a date, so it quotes no price ───────────────
  const FG = r('public/freeguide/index.html')
  check('the free guide sends readers to the pricing page instead of quoting a price', FG.includes('are on the pricing page') && !/plan is \$\d+\/month/.test(FG))
}

main().then(() => {
  if (failures.length) {
    console.error(`\n❌ new-member-prices: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✓ new-member-prices: $99/$199 until November 1, then $159/$299 by date; early members keep their price on either plan; the sales pages count down; checkout never charges a price the page did not show')
})
