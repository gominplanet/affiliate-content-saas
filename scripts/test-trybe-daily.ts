// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The daily 20 from a saved search, the same 200 a day for everyone, the
// search first on Find brands, and the gold sweet spot (Seb, 2026-11-18).

import { readFileSync } from 'node:fs'
import { readDailySearch, sameSearch, sweetSpot, sweetWords, paidOutOf, SWEET_MAX_CREATORS, SWEET_MIN_PAID } from '../lib/trybe-daily'
import { MAX_DAILY_CAP, DAILY_FIND } from '../lib/trybe-outreach'
import { NO_FILTERS } from '../components/labs/TrybeFinderControls'
import { searchWords } from '../components/labs/TrybeDailyBrands'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. The saved search
const s = readDailySearch({ categories: ['Pets'], keywords: ['dog toys', 'dog toys', ''], payType: 'flat', filters: { ...NO_FILTERS, maxCreators: 500, samples: true }, sort: 'picks', savedAt: '2026-11-18T10:00:00Z' })
check('a saved search is read back', !!s && s.categories.join() === 'Pets' && s.keywords.join() === 'dog toys' && s.payType === 'flat' && s.sort === 'picks' && s.filters.maxCreators === 500 && s.filters.samples === true && s.savedAt === '2026-11-18T10:00:00Z')
check('nothing saved reads as none', readDailySearch(null) === null && readDailySearch('x') === null && readDailySearch([]) === null)
const odd = readDailySearch({ payType: 'cash', sort: 'random', filters: 'x', savedAt: 'nope' })!
check('a bad pay, sort, filters or date falls back safely', odd.payType === 'any' && odd.sort === 'match' && odd.filters.maxCreators === null && odd.savedAt === null)
check('the same search in another order is the same', sameSearch({ ...s!, keywords: ['Dog Toys'] }, s!) && !sameSearch({ ...s!, payType: 'percent' }, s!) && !sameSearch({ ...s!, filters: { ...s!.filters, samples: false } }, s!))
check('the search is said in words', searchWords(s!).join(' | ') === '"dog toys" | Pets | Pays per video | Sends samples | Up to 500 creators | Best picks first')
check('an empty search says nothing, so the card says all of TRYBE', searchWords({ categories: [], keywords: [], payType: 'any', filters: NO_FILTERS, sort: 'match' }).length === 0)

// 2. The sweet spot
check('under 500 creators and $10K+ paid out is the sweet spot', sweetSpot({ total_creators: 120, stats: { paidOut: 25_000 } }) && SWEET_MAX_CREATORS === 500 && SWEET_MIN_PAID === 10_000)
check('500 creators or more is not', !sweetSpot({ total_creators: 500, stats: { paidOut: 25_000 } }))
check('under $10K paid out is not', !sweetSpot({ total_creators: 50, stats: { paidOut: 9_999 } }))
check('the payout range counts when the total is not read', sweetSpot({ total_creators: 80, earnings_bucket: '$10K - $50K' }) && !sweetSpot({ total_creators: 80, earnings_bucket: '$1K - $10K' }))
check('the total wins over the range', paidOutOf({ stats: { paidOut: 42_000 }, earnings_bucket: '$1K - $10K' }) === 42_000)
check('a brand MVP knows too little about is never called one', !sweetSpot({ total_creators: null, stats: { paidOut: 50_000 } }) && !sweetSpot({ total_creators: 40 }))
check('the chip says its own numbers', sweetWords({ total_creators: 120, stats: { paidOut: 25_400 } }) === '120 creators, $25K+ paid out' && sweetWords({ total_creators: 3, stats: { paidOut: 1_250_000 } }) === '3 creators, $1.3M+ paid out')

// 3. The cap
check('the same 200 a day for everyone', MAX_DAILY_CAP === 200 && DAILY_FIND === 20)

// 4. Wiring
const UI = read('components/labs/TrybeOutreach.tsx')
const R = read('app/api/labs/trybe/route.ts')
check('the daily box and the cap input are gone', !/Write messages to \{DAILY_FIND\} new brands every day when I open this page/.test(UI) && !/type="number" min=\{1\} max=\{MAX_DAILY_CAP\}/.test(UI))
check('the search comes before the daily card, and the setup after them', (() => { const a = UI.indexOf('{/* 2. Find brands.'), b = UI.indexOf('<TrybeDailyBrands'), c = UI.indexOf('{/* THE SETUP, FOLDED'), d = UI.indexOf("{/* 3. The live list") ; return a > 0 && a < b && b < c && c < d })())
check('the daily run takes the next brands from the saved search, never ones already messaged', /action: 'browse', categories: s\.categories, keywords: s\.keywords, payType: s\.payType, filters: s\.filters, sort: s\.sort, includeMine: false/.test(UI) && /filter\(b => !b\.status \|\| b\.status === 'new'\)\.slice\(0, room\)/.test(UI))
check('a day with nothing found says why', /No brands you have not messaged match your daily search today/.test(UI) && /TRYBE could not be read, so today/.test(UI))
check('the search is saved with the daily 20 turned on', /saveDaily\(\{ search: currentSearch, on: true \}\)/.test(UI))
check('the server saves the daily search safely and says the migration by number', /row\.daily_search = body\.dailySearch === null \? null : \{ \.\.\.readDailySearch\(body\.dailySearch\), savedAt: now \}/.test(R) && /daily search needs migration 469/.test(R))
check('the gold shows in the table and the cards, and is said', /const sweet = sweetSpot\(b\)/.test(read('components/labs/TrybeBrandTable.tsx')) && /sweetSpot\(b\) && <SweetChip/.test(UI) && /Gold: under 500 creators and \$10K\+ paid out to creators/.test(UI))
check('the migration is safe to run twice', /add column if not exists daily_search jsonb/.test(read('supabase/migrations/469_trybe_daily_search.sql')))

if (failures.length) {
  console.error(`test-trybe-daily: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-daily: all checks passed')
