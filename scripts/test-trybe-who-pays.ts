// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Who actually pays you, from the owner's own TRYBE week to 2026-11-20:
// $49.05 earned; Taste Flavor Co. $29.77 from 3 videos, BRYN $15.07 from 2;
// NOBL 57 approved, 56 active ads, 4.1K impressions, 187 clicks, $0.00, at
// 35% of GMV; every other brand about 730 impressions per active ad.

import { readFileSync } from 'node:fs'
import { adBrands, impressionsPerAd, medianOf, deliveryOf, zeroRead, zeroChance, concentrationOf, concentrationWords, whoPays, DELIVERY_MIN_ADS, type AdVideo, type PayFact } from '../lib/trybe-ads'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

let n = 0
const v = (brand: string, o: Partial<AdVideo>): AdVideo => ({ id: `v${++n}`, title: `${brand} ${n}`, brand, brandId: brand.toLowerCase().replace(/\W+/g, '-'), thumbnail: null, live: true, earned: 0, liveAds: 1, impressions: 730, clicks: 15, ctr: 2, hookRate: 30, avgWatchSec: 7, avgWatchPct: 30, spend: null, ...o })
const week: AdVideo[] = [
  v('Taste Flavor Co.', { earned: 20, impressions: 1500, liveAds: 2, clicks: 40 }), v('Taste Flavor Co.', { earned: 9.77, impressions: 700, clicks: 20 }), v('Taste Flavor Co.', { earned: 0, impressions: 720 }),
  v('BRYN', { earned: 10, impressions: 1460, liveAds: 2 }), v('BRYN', { earned: 5.07, impressions: 1460, liveAds: 2 }),
  v('ZipString', { earned: 1.5 }), v('ZipString', { earned: 0.75 }), v('ZipString', { earned: 0 }),
  v('Svaha USA', { earned: 1 }), v('Svaha USA', { earned: 0.91 }),
  v('Gains In Bulk', { earned: 0.03 }), v('SHAPERLUV', { earned: 0.02 }),
  v('NOBL', { earned: 0, liveAds: 28, impressions: 2050, clicks: 93, hookRate: 64.1, ctr: 4.51 }), v('NOBL', { earned: 0, liveAds: 28, impressions: 2050, clicks: 94, hookRate: 64.1, ctr: 4.51 }),
]

// 1. Delivery rides on each brand
const brands = adBrands(week)
const nobl = brands.find((b) => b.brand === 'NOBL')!
check('a brand carries its impressions, clicks and active ads', nobl.impressions === 4100 && nobl.clicks === 187 && nobl.activeAds === 56)
check('active ads come from TRYBE’s count per video, else its live videos, else not known', adBrands([v('X', { liveAds: null, live: true }), v('X', { liveAds: null, live: false })])[0].activeAds === 1 && adBrands([v('Y', { liveAds: null, live: null })])[0].activeAds === null)
check('a number TRYBE did not send stays not known', adBrands([v('Z', { impressions: null, clicks: null })])[0].impressions === null)

// 3. Are they running it?
check('impressions per active ad', Math.round(impressionsPerAd(nobl) as number) === 73 && impressionsPerAd({ impressions: null, activeAds: 5 }) === null && impressionsPerAd({ impressions: 100, activeAds: 0 }) === null)
const mid = medianOf(brands.filter((b) => (b.activeAds ?? 0) >= DELIVERY_MIN_ADS).map(impressionsPerAd))
check('your own median, not a fixed number', mid === 730)
check('NOBL is shelved: a tenth of your median', deliveryOf(nobl, mid) === 'shelved')
check('Taste Flavor is running', deliveryOf(brands.find((b) => b.brand === 'Taste Flavor Co.')!, mid) === 'running')
check('half the median is light', deliveryOf({ impressions: 1000, activeAds: 3 }, 730) === 'light')
check('missing numbers or too few ads are never called shelved', deliveryOf({ impressions: null, activeAds: 10 }, 730) === 'unknown' && deliveryOf({ impressions: 10, activeAds: 2 }, 730) === 'unknown' && deliveryOf(nobl, null) === 'unknown')

// 4. What a zero means
check('at 187 clicks a zero happens 15% of the time at 1 in 100', Math.round(zeroChance(187) * 100) === 15 && zeroRead(187, 0) === 'too_early')
check('at 600 clicks it is 0.2%, so the clicks are not buying', zeroChance(600).toFixed(3) === '0.002' && zeroRead(600, 0) === 'not_converting')
check('no clicks is not run; a brand that earned or sent no clicks gets no read', zeroRead(0, 0) === 'not_run' && zeroRead(187, 2) === null && zeroRead(null, 0) === null)

// 5. Concentration
const c = concentrationOf(week)
check('4 videos made 91.4%, for 2 brands', !!c && c.videos === 4 && c.of === 14 && c.share.toFixed(3) === '0.914' && c.brands.join('|') === 'Taste Flavor Co.|BRYN')
check('said in one line', !!c && concentrationWords(c) === '4 of your 14 videos made 91.4% of your earnings, all for Taste Flavor Co. and BRYN.')
check('spread earnings, nothing earned or a handful of videos say nothing', concentrationOf(Array.from({ length: 20 }, () => v('Even', { earned: 1 }))) === null && concentrationOf(week.map((x) => ({ ...x, earned: 0 }))) === null && concentrationOf(week.slice(0, 4)) === null)

// 2 and 6. Per approved video, and the advertised rate against what was paid
const facts: PayFact[] = [
  { brand: 'Taste Flavor Co.', brandId: 'taste-flavor-co-', approved: 3, earned: 29.77, advertised: '15% of GMV', advertisedPct: 15 },
  { brand: 'BRYN', brandId: 'bryn', approved: 2, earned: 15.07, advertised: '20% of GMV', advertisedPct: 20 },
  { brand: 'ZipString', brandId: 'zipstring', approved: 3, earned: 2.25, advertised: '10% of GMV', advertisedPct: 10 },
  { brand: 'Svaha USA', brandId: 'svaha-usa', approved: 2, earned: 1.91 },
  { brand: 'Gains In Bulk', brandId: 'gains-in-bulk', approved: 1, earned: 0.03 },
  { brand: 'SHAPERLUV', brandId: 'shaperluv', approved: 1, earned: 0.02 },
  { brand: 'NOBL', brandId: 'nobl', approved: 57, earned: 0, advertised: '35% of GMV', advertisedPct: 35 },
]
const wp = whoPays(brands, facts)
const order = wp.rows.map((r) => r.brand).join(' > ')
check('ranked by dollars per approved video', order === 'Taste Flavor Co. > BRYN > Svaha USA > ZipString > Gains In Bulk > SHAPERLUV > NOBL')
const tf = wp.rows[0]
check('Taste Flavor: $9.92 per approved video, said as approved', tf.perVideo != null && tf.perVideo.toFixed(2) === '9.92' && tf.perBasis === 'approved')
const nr = wp.rows.find((r) => r.brand === 'NOBL')!
check('NOBL: $0.00 per approved video across 57', nr.perVideo === 0 && nr.approved === 57 && nr.delivery === 'shelved' && nr.zero === 'too_early')
check('NOBL says its delivery in numbers', nr.says.includes('NOBL: 73 impressions per active ad. Your typical brand gets 730. It is barely running your videos.'))
check('NOBL says its zero is too early, with the chance', nr.says.some((x) => /^\$0 so far from 187 clicks\. Even if 1 click in 100 buys, no sale at all happens 15% of the time/.test(x)))
check('NOBL’s advertised rate against what it paid', nr.gap === 'NOBL advertises 35% of GMV, the highest you have. It has paid $0.00 across 57 approved videos.')
check('a brand that pays its rate has no gap', tf.gap === null && wp.rows.find((r) => r.brand === 'BRYN')!.gap === null)
check('with no approved count the denominator is the videos with ad results, and says so', whoPays(brands, []).rows[0].perBasis === 'ad_videos')
check('a brand with approved videos and no ads at all is still a row, judged on nothing it lacks', (() => { const r = whoPays([], [{ brand: 'Quiet', brandId: 'q', approved: 9, earned: 0 }]).rows[0]; return !!r && r.delivery === 'unknown' && r.zero === null && r.perVideo === 0 })())
check('no dashes in what it says', !/[–—]/.test(JSON.stringify(wp)))

// 7. Wired in
const UI = read('components/labs/TrybeAds.tsx')
check('the analytics tab says who pays, concentration first', /aria-label="Who actually pays you"/.test(UI) && /concentrationWords\(conc\)/.test(UI) && UI.indexOf('concentrationWords(conc)') < UI.indexOf('payRows.map'))
check('it joins TRYBE’s approved counts and earnings, and each brand’s advertised pay', /approved: s\.read \? s\?\.counts\.approved \?\? null : null/.test(UI) && /action: 'browse', ids/.test(UI) && /whoPays\(brands, facts\)/.test(UI))
check('the denominator is named in the label', /per approved video/.test(UI) && /per video with ad results/.test(UI))

if (failures.length) {
  console.error(`test-trybe-who-pays: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-who-pays: all checks passed')
