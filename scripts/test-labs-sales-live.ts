// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for two Labs previews: "On sale now" and "Amazon Live prep".

import { readFileSync } from 'node:fs'
import { saleVerdict, SALE_MIN_PCT, saleLabel } from '../lib/covered-sales'
import { layoutClock, assemblePlan, tidyLine, clockLabel, LIVE_MAX_PRODUCTS } from '../lib/live-plan'
import { canUsePreview } from '../lib/labs-preview'
import { tidyCopy } from '../lib/copy-rules'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrderCheck = (src: string, a: string, b: string) => { const i = src.indexOf(a), j = src.indexOf(b); return i > -1 && j > -1 && i < j }

// ── the house rules for copy ────────────────────────────────────────────────
{
  const now = new Date('2026-09-25T00:00:00Z')
  check('a range stays a range, and a spec number survives',
    tidyCopy('Runs 3–5 hours on 2000 mAh', now) === 'Runs 3 to 5 hours on 2000 mAh', tidyCopy('Runs 3–5 hours on 2000 mAh', now))
  check('this year and next are removed, dashes become commas, "honest" goes',
    !/2026|2027/.test(tidyCopy('Best of 2026, and the 2027 model', now))
    && tidyCopy('Look at this - wow', now) === 'Look at this, wow'
    && !/honest/i.test(tidyCopy('I am honestly impressed', now)))
}

// ── preview gate: only the owner sees these until they are opened ───────────
check('both previews are admin only while testing',
  canUsePreview('on_sale', 'admin') && !canUsePreview('on_sale', 'pro') && !canUsePreview('on_sale', 'trial')
  && canUsePreview('amazon_live', 'admin') && !canUsePreview('amazon_live', 'pro'),
  'a Pro user would see a feature the owner has not tested yet')
{
  const SHELL = read('components/layout/DashboardShellV2.tsx')
  check('and the nav follows the same switch',
    /href: '\/on-sale'[^\n]*gate: previewOpenToPro\('on_sale'\) \? isPro : isAdmin/.test(SHELL)
    && /href: '\/amazon-live'[^\n]*gate: previewOpenToPro\('amazon_live'\) \? isPro : isAdmin/.test(SHELL),
    'a nav gated on Pro shows a page whose routes refuse')
  for (const f of ['app/api/on-sale/route.ts', 'app/api/on-sale/promo/route.ts', 'app/api/on-sale/comment/route.ts']) {
    check(`${f} is gated on the preview`, /canUsePreview\('on_sale'/.test(read(f)) && !/canSeeNav\('labs'/.test(read(f)))
  }
  for (const f of ['app/api/live/products/route.ts', 'app/api/live/plan/route.ts', 'app/api/live/plans/route.ts', 'app/api/live/plans/[id]/route.ts']) {
    check(`${f} is gated on the preview`, /canUsePreview\('amazon_live'/.test(read(f)))
  }
  check('the daily alert job only alerts creators who have the feature',
    /filter\(\(r\) => canUsePreview\('on_sale', r\.tier\)\)/.test(read('app/api/cron/covered-sales/route.ts')),
    'every Pro dashboard would fill with alerts for a feature they cannot open')
}

// ── On sale now: the rule ───────────────────────────────────────────────────
const deal = (o: Partial<{ discount_pct: number | null; deal_type: string; lightning_ends_at: string | null }>) => ({
  discount_pct: null, price_now_cents: 1000, price_was_cents: 1500, deal_type: 'price_drop', lightning_ends_at: null, ...o,
})
check('a real sale counts, a small move does not',
  saleVerdict({ deal: deal({ discount_pct: SALE_MIN_PCT }) }).onSale
  && !saleVerdict({ deal: deal({ discount_pct: SALE_MIN_PCT - 1 }) }).onSale,
  `the line is ${SALE_MIN_PCT}%`)
check('a live lightning deal counts, an ended one does not',
  saleVerdict({ deal: deal({ deal_type: 'lightning', lightning_ends_at: new Date(Date.now() + 3600_000).toISOString() }) }).basis === 'lightning'
  && !saleVerdict({ deal: deal({ deal_type: 'lightning', lightning_ends_at: new Date(Date.now() - 60_000).toISOString() }) }).onSale)
check('Keepa decides when the shared cache has nothing',
  saleVerdict({ keepa: { priceNowCents: 800, priceAvg90Cents: 1000, priceLowestCents: 700, discountPct: 20 } }).onSale
  && !saleVerdict({ keepa: { priceNowCents: 950, priceAvg90Cents: 1000, priceLowestCents: 700, discountPct: 5 } }).onSale
  && saleVerdict({ keepa: { priceNowCents: 690, priceAvg90Cents: 730, priceLowestCents: 700, discountPct: 6 } }).allTimeLow,
  'a new all-time low is news even when it is a small cut')
check('no data is no sale', !saleVerdict({}).onSale && !saleVerdict({ keepa: { priceNowCents: null, priceAvg90Cents: null, priceLowestCents: null, discountPct: null } }).onSale)
check('the label is words, not a guess', saleLabel(saleVerdict({ deal: deal({ discount_pct: 30 }) })) === '30% off')
{
  const LIB = read('lib/covered-sales.ts')
  check('the free shared cache is read before any Keepa token is spent',
    LIB.indexOf("from('deal_radar_cache')") > -1 && LIB.indexOf("from('deal_radar_cache')") < LIB.indexOf('fetchKeepaBasicsCached(admin, rest')
    && /\.filter\(\(p\) => !deals\.has\(p\.asin\)\)/.test(LIB) && /videoFirst\.slice\(0, opts\?\.keepaCap \?\? 50\)/.test(LIB),
    'a creator with a big catalogue would spend the day\'s Keepa budget on products the cache already knew')
  const PROMO = read('app/api/on-sale/promo/route.ts')
  check('the promo never states a price or a percentage, and never names a sale event',
    /NEVER state a price, a dollar amount, or a percentage/.test(PROMO) && /Do NOT name any Amazon sale event/.test(PROMO)
    && !/detectOccasion|canNameEvent/.test(PROMO),
    'a sale price is true for hours, and "it is October so it is Prime" is a false claim on a real video')
  check('no promo for a product that is no longer on sale',
    /if \(!sale\) \{\s*return NextResponse\.json\(\{ error: 'This one is not on sale any more/.test(PROMO),
    'a comment saying "on sale right now" would sit on the video saying something untrue')
  check('and its copy goes through the shared house rules',
    /const tidy = \(s: unknown\) => tidyCopy\(s\)/.test(PROMO) && /return tidyCopy\(s\)/.test(read('lib/live-plan.ts')))
  check('the creator\'s banned words reach the prompt (the column is text, not an array)',
    /String\(raw \?\? ''\)\.split\(/.test(PROMO) && /const avoid = avoidList\(brand\?\.words_to_avoid\)/.test(PROMO))
  check('the comment always carries the link, and the social sheet gets the post without a second link',
    /if \(comment && !comment\.includes\(link\)\) comment = /.test(PROMO) && /socialForSheet:/.test(PROMO)
    && /promo\.promo\.socialForSheet/.test(read('components/labs/OnSale.tsx')))
  const CMT = read('app/api/on-sale/comment/route.ts')
  check('the comment is posted only as the video\'s own channel, asked of YouTube',
    /me\.id !== owner/.test(CMT) && inOrderCheck(CMT, 'me.id !== owner', 'yt.postComment('),
    'a login can fall back to the default channel, and the comment would come from somebody else')
  check('a comment only ever goes on the creator\'s own video, through that video\'s channel',
    /from\('youtube_videos'\)\s*\.select\('id,channel_id'\)\.eq\('user_id', user\.id\)\.eq\('youtube_video_id', videoId\)/.test(CMT)
    && /getChannelOAuthToken\(supabase, user\.id, vid\.channel_id \?\? null\)/.test(CMT),
    'a comment on somebody else\'s video, or from the wrong channel, cannot be taken back quietly')
  const CRON = read('app/api/cron/covered-sales/route.ts')
  check('one alert per product per week unless the sale gets deeper',
    /const REALERT_DAYS = 7/.test(CRON) && /\(p\.verdict\.pct \?\? 0\) >= was \+ DEEPER_BY/.test(CRON)
    && /m \? Number\(m\[1\]\) : 100/.test(CRON))
  check('the job stops before Keepa runs dry for everyone else',
    /tokens\.tokensLeft != null && tokens\.tokensLeft < 150\) break/.test(CRON))
  const KC = read('lib/keepa-cache.ts')
  check('a Keepa batch that never answered is not cached as "no data"',
    /missing\.filter\(\(a\) => fetched\.has\(a\)\)/.test(KC) && !/empty: true, fetched_at: at/.test(KC),
    'one token-starved minute blanked a day of prices for every feature reading the shared cache')
  check('the page says how many were actually checked',
    /checked: stats\.checked/.test(read('app/api/on-sale/route.ts')) && /not checked this time/.test(read('components/labs/OnSale.tsx')))
  check('rewriting the promo clears "Posted."', /setPosted\(null\)\s*\n\s*setPromo\(j as Promo\)/.test(read('components/labs/OnSale.tsx')))
  for (const [pg, feat] of [['app/(dashboard)/on-sale/page.tsx', 'on_sale'], ['app/(dashboard)/amazon-live/page.tsx', 'amazon_live']] as const) {
    check(`${pg} follows the preview switch`, new RegExp(`canUsePreview\\('${feat}', tier\\)`).test(read(pg)) && !/canSeeNav/.test(read(pg)))
  }
  check('the job is on the schedule', /"\/api\/cron\/covered-sales"/.test(read('vercel.json')))
  check('alerts show in the dashboard box', /a\.kind === 'covered_sale'/.test(read('components/dashboard/PriceAlertsPanel.tsx')))
}

// ── Amazon Live: the clock always adds up ───────────────────────────────────
for (const m of [30, 45, 60, 90]) {
  for (const n of [1, 3, 7, LIVE_MAX_PRODUCTS]) {
    const c = layoutClock(m, Array.from({ length: n }, (_, i) => ({ saleLabel: i % 2 ? 'x' : null })))
    const sum = c.opening + c.closing + c.segments.reduce((a, s) => a + s.minutes, 0)
    const contiguous = c.segments.every((s, i) => s.startMin === (i === 0 ? c.opening : c.segments[i - 1].startMin + c.segments[i - 1].minutes))
    check(`a ${m} minute show with ${n} products adds up`, sum === m && contiguous && c.segments.every((s) => s.minutes >= 1), `sum ${sum}`)
  }
}
{
  const products = [
    { asin: 'B0AAAAAAAA', title: 'First Thing', image: null, bullets: ['Point one', 'Point two'], transcript: '', videoTitle: null, saleLabel: null },
    { asin: 'B0BBBBBBBB', title: 'Second Thing', image: null, bullets: ['Only point'], transcript: '', videoTitle: 'My review', saleLabel: '20% off' },
  ]
  const plan = assemblePlan({ title: 'Kitchen - 2026 picks', minutes: 30, products, model: { products: [{ asin: 'B0BBBBBBBB', hook: 'Look at this — really', talkingPoints: ['It is honestly great'] }], chatPrompts: ['What do you cook?'] } })
  check('a product the writer skipped keeps its slot, with the listing\'s points',
    plan.segments.length === 2 && plan.segments[0].asin === 'B0AAAAAAAA' && plan.segments[0].talkingPoints[0] === 'Point one')
  check('the writer\'s words are cleaned: no dashes, no year, no "honest"',
    !/[—–]| - /.test(plan.segments[1].hook) && !/2026/.test(plan.title) && !/honest/i.test(plan.segments[1].talkingPoints.join(' ')),
    JSON.stringify({ hook: plan.segments[1].hook, title: plan.title, tp: plan.segments[1].talkingPoints }))
  check('chat prompts sit inside the show, not in the opening or the close',
    plan.chatPrompts.every((p) => p.atMin >= plan.opening.minutes && p.atMin < plan.closing.startMin))
  check('the clock reads like a clock', clockLabel(0) === '0:00' && clockLabel(65) === '1:05:00' && clockLabel(12) === '12:00')
  check('tidyLine keeps a normal sentence as it is', tidyLine('Grab it while it lasts.') === 'Grab it while it lasts.')
}
{
  const PLAN = read('app/api/live/plan/route.ts')
  const LIB = read('lib/live-plan.ts')
  check('the live script never states a price either', /NEVER state a price, a dollar amount, or a percentage/.test(LIB))
  check('a plan is still returned when it cannot be saved, and says so',
    /saved: !saveErr/.test(PLAN) && /needs migration 373/.test(PLAN) && /j\.saveError/.test(read('components/labs/AmazonLive.tsx')))
  check('products are capped so each gets real time', /asins\.length > LIVE_MAX_PRODUCTS/.test(PLAN) && /minutes < asins\.length \* 2 \+ 4/.test(PLAN))
  check('the listings share one 25 second clock, and a cut-off reply is not a plan',
    /setTimeout\(res, 25_000\)/.test(PLAN) && /msg\.stop_reason === 'max_tokens'/.test(PLAN))
  check('the teleprompter measures "behind" against the next part\'s start',
    /const behind = started \? Math\.floor\(elapsed \/ 60\) - nextAt : 0/.test(read('components/labs/AmazonLive.tsx')))
  const M = read('supabase/migrations/373_on_sale_and_live_plans.sql')
  check('the tables are twice-runnable',
    /create table if not exists public\.covered_sale_checks/.test(M) && /create table if not exists public\.live_plans/.test(M)
    && /drop policy if exists "live_plans_own"/.test(M))
}

if (failures.length) {
  console.error(`\n❌ labs-sales-live: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ labs-sales-live: admin-only previews, a sale rule with a line, a promo with no prices, and a show clock that adds up')
