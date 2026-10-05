// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NEW MEMBERS PAY THE NEW PRICE, EVERYONE ELSE KEEPS THEIRS, AND NOBODY IS
// CHARGED A PRICE THE PAGE DID NOT SHOW.
//
// Seb, 2026-10-05: Amazon $139 and Pro $299 for new members only. Yearly
// follows at about two months free ($1,399 and $2,999). Stripe prices are
// immutable, so the new prices are new Stripe price ids placed FIRST in the
// env lists, with the old ids kept after them so renewals still map.
//
// Run: npx tsx scripts/test-new-member-prices.ts
import { readFileSync } from 'node:fs'
import { TIERS, NEW_MEMBER_PRICES, NEW_MEMBER_PRICES_LIVE } from '../lib/tier'
import { shownPriceCents, PRICE_MISMATCH_ERROR } from '../lib/price-guard'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: string) => { if (!ok) failures.push(detail ? `${name}: ${detail}` : name) }
const r = (p: string) => readFileSync(p, 'utf8')

// ── the prices ──────────────────────────────────────────────────────────────
// Run twice by the build: with the Vercel switch off (today's prices) and on.
check('the new-member prices are Amazon $139 / $1,399 and Pro $299 / $2,999',
  NEW_MEMBER_PRICES.amazon.month === 139 && NEW_MEMBER_PRICES.amazon.year === 1399
  && NEW_MEMBER_PRICES.pro.month === 299 && NEW_MEMBER_PRICES.pro.year === 2999)
check('the switch is the one Vercel env var', /export const NEW_MEMBER_PRICES_LIVE = process\.env\.NEXT_PUBLIC_NEW_MEMBER_PRICES === 'on'/.test(r('lib/tier.ts')))
const want = NEW_MEMBER_PRICES_LIVE
  ? { a: 139, ay: 1399, p: 299, py: 2999 }
  : { a: 99, ay: 999, p: 199, py: 1999 }
check(`with the switch ${NEW_MEMBER_PRICES_LIVE ? 'on' : 'off'}, the page shows $${want.a} and $${want.p}`,
  TIERS.amazon.price === want.a && TIERS.amazon.annualPrice === want.ay && TIERS.pro.price === want.p && TIERS.pro.annualPrice === want.py,
  JSON.stringify([TIERS.amazon.price, TIERS.amazon.annualPrice, TIERS.pro.price, TIERS.pro.annualPrice]))
check('yearly is still cheaper than twelve months', TIERS.amazon.annualPrice! < TIERS.amazon.price * 12 && TIERS.pro.annualPrice! < TIERS.pro.price * 12)
check('the shown price in cents is what the guard compares',
  shownPriceCents('amazon', 'month') === want.a * 100 && shownPriceCents('pro', 'month') === want.p * 100
  && shownPriceCents('pro', 'year') === want.py * 100 && shownPriceCents('amazon', 'year') === want.ay * 100)
check('the refusal says what is happening, without dash punctuation', /checkout is paused/.test(PRICE_MISMATCH_ERROR) && !/[—–]| - /.test(PRICE_MISMATCH_ERROR))

// ── checkout refuses a price the page did not show ──────────────────────────
const CO = r('app/api/stripe/checkout/route.ts')
const guardAt = CO.indexOf("await priceMismatch(stripe, priceId, tier as Tier, annualId ? 'year' : 'month', 'checkout')")
check('checkout compares the Stripe price with the shown one', guardAt > 0)
check('before it changes a subscription or opens a session',
  guardAt > 0 && guardAt < CO.indexOf('stripe.subscriptions.update(') && guardAt < CO.indexOf('stripe.checkout.sessions.create('))
const SP = r('app/api/auth/signup-paid/route.ts')
const spAt = SP.indexOf("await priceMismatch(getStripe(), priceId, tier as Tier, 'month', 'paid signup')")
check('paid signup checks it before the account is created', spAt > 0 && spAt < SP.indexOf('admin.auth.admin.createUser('))

// ── a member on an older price is not moved onto the new one ────────────────
check('re-selecting your own plan keeps the price you pay',
  /const tierIds = PRICE_ID_LIST\[tier as keyof typeof PRICE_ID_LIST\] \?\? \[\]/.test(CO)
  && /\(sameInterval && !!item\.price\?\.id && tierIds\.includes\(item\.price\.id\)\)/.test(CO)
  && CO.indexOf('tierIds.includes(item.price.id)') < CO.indexOf('const isUpgrade'))

// ── the billing page shows what the member pays, not the new-member price ───
const PS = r('app/api/stripe/plan-status/route.ts')
check('plan-status reports the live subscription price', /const paying = livePrice\?\.unit_amount != null/.test(PS))
const BP = r('app/(dashboard)/billing/page.tsx')
check('billing shows that amount', /paying \? ` · \$\$\{paying\.amountUsd\.toLocaleString\('en-US'\)\}\/\$\{paying\.interval\}` : ''/.test(BP))
check('and never the new-member price as the member’s own', !/currentTier\.price > 0 \? ` · \$\$\{currentTier\.price\}\/month`/.test(BP))

// ── static copy cannot follow a switch, so it quotes no price ───────────────
const FG = r('public/freeguide/index.html')
check('the free guide sends readers to the pricing page instead of quoting a price', FG.includes('are on the pricing page') && !/plan is \$\d+\/month/.test(FG))

if (failures.length) {
  console.error(`\n❌ new-member-prices: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✓ new-member-prices: Amazon $139 and Pro $299 for new members, older members keep their price, and checkout refuses a price the page did not show')
