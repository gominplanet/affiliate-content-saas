// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A NUMBER AMAZON HID IS NEVER SHOWN AS $0 (Seb, 2026-10-15).
//
// Amazon reports a product's figures only past a minimum of a few sales, and
// its data is not going to get more detailed. Below that minimum the figure
// arrives blank or the product is missing from the report. A blank is "not
// reported": showing it as $0, 0 orders, "no sale yet" or "Clicks, no sales"
// tells a creator something Amazon never said.
//
// The sweep found eleven places that turned a blank into a zero. Each is held
// here: the campaign library by behaviour, the routes and screens by source.
import { readFileSync } from 'node:fs'
import { buildCampaignLibrary, type JoinedCampaign, type ContentPiece } from '../lib/campaign-library'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: string) => { if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── Joined campaigns, by behaviour ──────────────────────────────────────────
{
  const NOW = new Date('2026-10-15T12:00:00Z')
  const day = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10)
  const blog: ContentPiece = { kind: 'blog', url: 'https://x/p', title: 'A post', at: day(-5) }
  const camp = (asin: string, earned: JoinedCampaign['earned']): JoinedCampaign => ({
    asin, campaignId: asin, brand: 'B', product: asin, imageUrl: null, commissionPct: 10, priceCents: 4000,
    startsAt: day(-30), endsAt: day(20), joinedAt: day(-10), messagedAt: day(-10), detailsUrl: null, content: [blog], earned,
  })
  const lib = buildCampaignLibrary([
    camp('HIDDEN0001', { clicks: null, orders: null, cents: null }),
    camp('CLICKSONLY', { clicks: 12, orders: null, cents: null }),
    camp('REALZERO01', { clicks: 12, orders: 0, cents: 0 }),
    camp('PAID000001', { clicks: 40, orders: 3, cents: 1200 }),
  ], NOW)
  const note = (a: string) => lib.rows.find((r) => r.asin === a)?.note || ''
  check('a product Amazon has not reported says so', /has not reported this product/.test(note('HIDDEN0001')), note('HIDDEN0001'))
  check('hidden orders never read as "no sale yet"', !/no sale yet/.test(note('CLICKSONLY')) && /has not reported its sales/.test(note('CLICKSONLY')), note('CLICKSONLY'))
  check('a real 0 orders still says no sale yet', /no sale yet/.test(note('REALZERO01')), note('REALZERO01'))
  check('the total counts what was reported and says how many were not', lib.summary.earnedCents === 1200 && lib.summary.unreported === 2, JSON.stringify(lib.summary))
}

// ── The routes and screens, by source ───────────────────────────────────────
const LIBR = read('app/api/campaigns/library/earnings/route.ts')
check('campaign earnings: a product never reported stays null', /clicks: number \| null; orders: number \| null; cents: number \| null/.test(LIBR) && /b == null \? a : \(a \?\? 0\) \+ b/.test(LIBR) && !/prev\.cents \+ \(e\.earnings_cents \?\? 0\)/.test(LIBR))
const JOINED = read('app/(dashboard)/joined-campaigns/page.tsx')
check('joined campaigns: a product missing from the report is null, not 0', /totals\[row\.asin\] \?\? \{ clicks: null, orders: null, cents: null \}/.test(JOINED) && /not reported by Amazon yet/.test(JOINED))

const BH = read('app/api/seo/blog-health/route.ts')
check('blog health: only reported months count, so blanks are never "not buying"', /filter\(r => r\.earnings_cents != null\)/.test(BH) && !/r\.earnings_cents \?\? 0/.test(BH))

const SF = read('app/api/storefront/analytics/route.ts')
check('storefront: money() keeps a blank blank', /cents == null \? null : Math\.round\(cents\) \/ 100/.test(SF))
check('storefront: sums add only what was reported', /function sumN/.test(SF) && !/r\.units \?\? 0/.test(SF) && !/r\.clicks \?\? 0/.test(SF))
check('storefront: a ratio needs both figures', /num == null \|\| den == null \|\| den <= 0 \? null/.test(SF))
check('storefront: a delta needs both periods', /prevEarnings == null \|\| earnings == null \? null/.test(SF))
const AB = read('components/amazon/AmazonBrainstorm.tsx')
check('storefront page: a blank reads "not reported"', /const NR = 'not reported'/.test(AB) && /n == null \? NR/.test(AB))
check('storefront page: "Clicks, no sales" only on a reported 0', /\(p\.clicks \?\? 0\) >= 5 && p\.earnings === 0/.test(AB))
check('storefront page: missing last period is "not in last report", not "new"', /not in last report/.test(AB) && !/<span>· new<\/span>/.test(AB))
const CH = read('components/amazon/StorefrontCharts.tsx')
check('storefront charts: plot only reported figures', /const reported = </.test(CH) && /reported\(productsIn, \['clicks', 'conversion', 'earnings'\]\)/.test(CH))
const CAT = read('app/api/storefront/catalog/route.ts')
check('storefront catalog: a blank stays null', /c == null \? null : Math\.round\(c\) \/ 100/.test(CAT) && !/cur\.units \+= r\.units \?\? 0/.test(CAT))
check('storefront catalog screen: a blank reads "not reported"', /n == null \? 'not reported'/.test(read('components/amazon/StorefrontCatalog.tsx')))
const ING = read('app/api/storefront/ingest/route.ts')
check('storefront snapshot: a blank is saved as null, not 0', /earnings_cents: null, revenue_cents: null, units: null, clicks: null/.test(ING) && !/cur\.earnings_cents \+= r\.earnings_cents \?\? 0/.test(ING))

const EARN = read('app/(dashboard)/earnings/page.tsx')
check('earnings page: only a row of real zeros folds away', /\.every\(\(v\) => v === 0\)/.test(EARN))
const SOLD = read('components/earnings/SoldCampaigns.tsx')
check('products you already sell: a hidden figure says so', /orders below Amazon\\u2019s reporting minimum/.test(SOLD) && /earnings not reported by Amazon/.test(SOLD))

if (fails.length) { console.error('amazon-hidden failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ amazon-hidden: a figure Amazon did not report is never shown as $0, 0 or "no sales"')
