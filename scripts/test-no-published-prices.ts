// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NOTHING MVP PUBLISHES CARRIES A PRICE.
//
// Amazon's Associates policy 2(b): a page may show a price only when Amazon
// serves it or it comes from Amazon's own API (with a time stamp), and a
// discount only while the promotion lasts. MVP has neither, so no published
// surface states a price, a dollar amount or a percentage off. "Deal", "on
// sale" and "check today's price" are the words it has.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

const DIGEST = r('lib/weekly-digest.ts')
check('weekly digest: no price line, and the writer never sees a price',
  /const priceLine = ''/.test(DIGEST) && !/now \$\{price\}/.test(DIGEST) && /NEVER state a price, a dollar amount, a percentage or a saving/.test(DIGEST)
  && /!containsPriceClaim\(written\)/.test(DIGEST))

const IDEA = r('app/api/idea-list/generate/route.ts')
check('idea lists: no price or star line on a card, and the writer is told why',
  /const meta = ''/.test(IDEA) && !/dollars\(p\.priceCents\)/.test(IDEA) && /NEVER write a price, a dollar amount, a percentage, a star rating/.test(IDEA))

const DEALS = r('app/api/deals/route.ts')
check('deals: the excerpt carries no amount', /const lead = `Deal alert on \$\{cleanTitle\}\.`/.test(DEALS))
check('deals: the writer and the refresh are never given a number and never state one',
  /Do NOT state any price, dollar amount or percentage\./.test(DEALS) && /NEVER state a price, a dollar amount or a percentage anywhere/.test(DEALS)
  && !/Current sale price:/.test(DEALS) && !/Just state the new prices directly/.test(DEALS))

const GEN = r('app/api/blog/generate/route.ts')
check('review data (JSON-LD) never carries a price', /const includePrice = false/.test(GEN))
check('the old price button now removes prices from posts',
  /delete offer\.price/.test(r('app/api/blog/refresh-prices/route.ts')) && !/offer\.price = numericPrice/.test(r('app/api/blog/refresh-prices/route.ts')))

const YT = r('app/api/youtube/generate-metadata/route.ts')
check('YouTube: never given a price, told never to write one, and no example title has one',
  /6\. NO PRICES\./.test(YT) && !/`Price: \$\{/.test(YT) && !/\$30 Kettle|\$400 Pan/.test(YT))

check('Ended Deals: the revived chip and intro carry no percentage',
  /const badge = 'ON SALE'/.test(r('lib/deal-aftercare.ts')) && /const badge = 'ON SALE'/.test(r('lib/deal-aftercare-server.ts'))
  && /const lead = 'On sale again right now\.'/.test(r('lib/deal-aftercare.ts')))
check('Deal check block: no percentage below the usual price', !/`About \$\{a\.pctBelowAvg90\}% below/.test(r('services/keepa/index.ts')))

// ── posts already live ─────────────────────────────────────────────────────
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stripPublishedPrices, cleanDealExcerpt } = require('../lib/published-price-sweep') as typeof import('../lib/published-price-sweep')
  const digest = '<h3>Fan</h3>\n<p><strong>$59.99</strong> <span style="text-decoration:line-through;color:#888">$89.99</span> · about 33% off</p>\n<p>Nice fan.</p>\n<p><a href="x">See the deal on Amazon</a></p>'
  const d = stripPublishedPrices(digest) || ''
  check('old digest: the price line goes, the write up stays', !/\$59\.99|33% off/.test(d) && /Nice fan\./.test(d) && /Check today's price on Amazon/.test(d))
  const idea = '<div><p style="margin:0 0 .85rem;color:#555;">$24.99 · 4.5★ (1,234)</p><p>Great gift.</p></div>'
  const i = stripPublishedPrices(idea) || ''
  check('old idea list: the price and stars line goes, the card stays', !/\$24\.99/.test(i) && /Great gift\./.test(i))
  check('a post with no printed price is left alone', stripPublishedPrices('<p>Nothing to see.</p>') === null)
  check('old deal excerpt: the amount and percentage go', cleanDealExcerpt('Save $47 (~32%) on LEVOIT Tower Fan. Limited-time pricing worth catching.') === 'Deal alert on LEVOIT Tower Fan. Check today\'s price before it changes.')
  check('old deal excerpt over two lines is still cleaned', cleanDealExcerpt('Save about 20% on Chia Seeds.\nPrime Day pick.') === 'Deal alert on Chia Seeds. Prime Day pick.')
  check('a clean excerpt is left alone', cleanDealExcerpt('Deal alert on a fan.') === null)
  const CRON = r('app/api/cron/reconcile-stuck-images/route.ts')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stripSchemaPrice } = require('../lib/published-price-sweep') as typeof import('../lib/published-price-sweep')
  const ld = JSON.stringify({ '@graph': [{ '@type': 'Product', offers: { '@type': 'Offer', price: 59.99, priceCurrency: 'USD', priceValidUntil: '2026-10-08', availability: 'InStock', url: 'x' } }] })
  const cleanLd = stripSchemaPrice(ld)
  check('review data: price, currency and expiry go; the offer and availability stay',
    !!cleanLd && !/59\.99|priceCurrency|priceValidUntil/.test(cleanLd) && /InStock/.test(cleanLd) && /"Offer"/.test(cleanLd))
  check('review data without a price is left alone', stripSchemaPrice(JSON.stringify({ '@graph': [{ '@type': 'Product', offers: { '@type': 'Offer' } }] })) === null)
  check('every account, in the background', /schemaPrices = await sweepSchemaPrices\(admin\)/.test(r('app/api/cron/reconcile-stuck-images/route.ts')))
  check('the sweep runs every ten minutes, on its own, and reports', /prices = await sweepPublishedPrices\(admin\)/.test(CRON) && /\n    prices,\n/.test(CRON))
}

if (failures.length) {
  console.error(`\n❌ no-published-prices: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ no-published-prices: no digest, idea list, deal, review data, YouTube text or deal chip states a price or a percentage')
