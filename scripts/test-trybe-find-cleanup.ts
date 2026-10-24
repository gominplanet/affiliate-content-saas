// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE FIND AND STAR BRANDS, CLEANED UP (Seb, 2026-10-24: "take your time
// and fix all issues and illogical messes inside of the Trybe feature").
// Holds what the review of Find brands and Star brands found:
//   - the search ranks real signals (rated, Top 100, Meta ads, newest), never
//     brand ids, pages past 1,000 rows and says when more matched;
//   - the daily refresh counts every stale brand, oldest first, and says
//     "every brand" only when none is left;
//   - "Count the next 40" says saved versus kept, keeps the own-ads check
//     and marks a brand tried, so the same forty are not offered forever;
//   - creator-count features are hidden while TRYBE gives no counts, and
//     "how crowded" is judged by videos alone;
//   - a % of ad spend is never a % of sales;
//   - a failed Amazon read is "not known", never "not on Amazon";
//   - Compare trusts only the brand's own recent Meta count, and rates;
//   - Star brands drops a late answer and a star is saved in one statement;
//   - every "not known" names where it comes from;
//   - links name where they go.
import { readFileSync } from 'node:fs'
import { crowdOf, spendingOf, filterCheck, readFilters } from '../lib/trybe-finder'
import { payReadOf } from '../lib/trybe-pay'
import { payPasses } from '../lib/trybe-outreach'
import { compareRows } from '../lib/trybe-compare'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const ROUTE = read('app/api/labs/trybe/route.ts')
const MIG = read('supabase/migrations/456_trybe_directory_rank.sql')
const OUT = read('components/labs/TrybeOutreach.tsx')
const CTRL = read('components/labs/TrybeFinderControls.tsx')

// The search.
check('migration 456 ranks rated, Top 100, Meta ads and newest, never brand id first', /\(d\.raw->>'reviewRating'\) is not null desc,\s+d\.top100_hits desc nulls last,\s+d\.meta_ads desc nulls last,\s+d\.first_seen_at desc nulls last,\s+d\.brand_id/.test(MIG) && !/trybe_score/.test(MIG.split('as $$')[1] || ''))
check('Newest orders by the join date, and brands TRYBE dropped are left out before the limit', /when p_sort = 'newest' then coalesce\(d\.raw->>'joinedAt'/.test(MIG) && /p_since is null or d\.last_seen_at >= p_since/.test(MIG))
check('migration 456 is safe to run twice and server only', /create or replace function public\.trybe_directory_rank/.test(MIG) && /create or replace function public\.trybe_star/.test(MIG) && /revoke all on function public\.trybe_star/.test(MIG) && /grant execute on function public\.trybe_directory_rank\(text\[\], uuid, integer, text, timestamptz\) to service_role/.test(MIG))
check('the search is paged past 1,000 rows and falls back to the old one before 456', /\.range\(from, Math\.min\(o\.limit, from \+ 1000\) - 1\)/.test(ROUTE) && /rpc\('trybe_directory_search', \{ p_words: o\.words/.test(ROUTE))
check('"more matched" is told from what the search returned', /capped: !direct && !starPool && \(rpc\.error \? rows\.length >= 800 : searched\.got >= pool\)/.test(ROUTE))

// The daily refresh.
check('what to count next is read over all of TRYBE, oldest first, light', /const LIGHT = 'brand_id, name, meta_ads, meta_ads_checked_at, top100_hits, rating:raw->>reviewRating'/.test(ROUTE) && /order\('meta_ads_checked_at', \{ ascending: true, nullsFirst: true \}\)/.test(ROUTE) && /starTodo \?\? shown\.filter/.test(ROUTE))
check('"every brand" only when none is left', /const allDone = done && left === 0/.test(OUT) && /\$\{allDone \? ' Every brand on TRYBE now has a count from this week\.' : leftWords\}/.test(OUT))
check('background reads no longer order by the empty TRYBE score', !/order\('trybe_score'/.test(read('app/api/cron/trybe-directory/route.ts')))

// Count the next 40.
const META = read('components/labs/metaAdsRead.ts')
check('saved and kept are said apart', /saved, kept, galleryAds/.test(ROUTE) && /\$\{run\.saved\} saved, \$\{run\.kept\} kept as they were/.test(META))
check('the own-ads check is kept even when the count is too recent, and 0 cards marks it tried', /\(wrote \|\| \(before && 'meta_ads_sample' in before && before\.meta_ads_sample == null\)\)/.test(ROUTE) && /\.\.\.\(check \? \{ own: check\.own, sample: check\.sample \} : \{\}\)/.test(META))

// Creator counts.
check('how crowded is judged by videos when TRYBE gives no creator count', crowdOf({ creators: null, recent30: 12 }).level === 'open' && crowdOf({ creators: null, recent30: 500 }).level === 'crowded' && crowdOf({ creators: null }).level === null)
check('Untapped and the creator limit are not offered without creator counts', /PRESETS\.filter\(\(p\) => !\(noCreators && p\.filters\.maxCreators\)\)/.test(CTRL) && /\{!noCreators && numberBox\('maxCreators'/.test(CTRL))
check('Fewest creators is not offered without creator counts', /live\?\.creatorsKnown !== false \|\| s\.id !== 'creators' \|\| sortBy === 'creators'/.test(OUT))
check('the copy says per review and less competition, not few creators', /line: 'Top rated, most Meta ads per review'/.test(OUT) && /label: 'Less competition'/.test(read('lib/trybe-pick.ts')) && !/Big ad budgets, few creators/.test(OUT))

// Pay.
const adOnly = payReadOf(['10% of ad spend'])
check('a % of ad spend alone is never a % of sales', adOnly.percent == null && !payPasses(adOnly, 'percent') && payPasses(adOnly, 'adspend'))
check('a % of sales is still one', payReadOf(['15% of sales']).percent === 15)

// Amazon.
const NO = readFilters({})
const row = { perVideo: null, creators: null, stats: { videosApproved: null, paidOut: null, samples: null, joinedAt: null, videos30d: null }, earningsBucket: null, amazon: null, starred: false, crowd: null }
check('a failed Amazon read is not known, a clean one is a no', filterCheck({ ...row, amazonUnknown: true }, { ...NO, onAmazon: true }).unknown.includes('onAmazon') && filterCheck(row, { ...NO, onAmazon: true }).failed.includes('onAmazon'))
check('your Amazon videos are read past 1,000 rows', /allRows<AmazonVideoProduct>\(\(\) => admin\.from\('amazon_video_products'\)/.test(ROUTE))

// Freshness.
const now = Date.parse('2026-10-24T12:00:00Z')
check('a Meta count over four weeks old says nothing about spending', spendingOf({ meta_ads: 40, meta_ads_checked_at: '2026-09-01T00:00:00Z' }, now) === null && spendingOf({ meta_ads: 40, meta_ads_checked_at: '2026-10-20T00:00:00Z' }, now) === true)

// Compare.
const rows = compareRows([
  { brand_id: 'a', name: 'A', meta_ads: 50000, meta_ads_checked_at: '2026-10-20T00:00:00Z', meta_trust: 'capped', review_rating: 4.2, review_count: 10 },
  { brand_id: 'b', name: 'B', meta_ads: 40, meta_ads_checked_at: '2026-10-20T00:00:00Z', meta_trust: 'own', review_rating: 4.8, review_count: 3 },
], now)
const meta = rows.find((r) => r.label === 'Meta ads running')
check('Compare never makes a common-word count the better one', meta?.best !== 0 && /common name/.test(meta?.values[0] || ''))
check('Compare has a TRYBE rating row', rows.find((r) => r.label === 'TRYBE rating')?.best === 1)
check('Compare leaves out a creator row nobody has', !rows.some((r) => r.label === 'Creators'))

// Star brands.
const STAR = read('components/labs/TrybeStarBrands.tsx')
check('Star brands drops a late answer and reloads with the current filter', /if \(id !== reqId\.current\) return/.test(STAR) && /onChunk: all \? \(\) => loadRef\.current\(\) : undefined/.test(STAR))
check('a star is saved in one statement, and starred ids go 150 at a time', /rpc\('trybe_star', \{ p_user: ownerId, p_brand: brandId/.test(ROUTE) && /starList\.slice\(i \* 150, i \* 150 \+ 150\)/.test(ROUTE))
check('Star brands says how long a count is used', /counted again after a week, and used for up to four weeks/.test(STAR) && !/running now, no reviews yet/.test(STAR))

// Words.
check('each "not known" names its source, not TRYBE', /MVP has not read the website of \$\{brands\(n\)\} yet, which is where TikTok Shop shows\./.test(CTRL) && /No MVP member has had videos decided by/.test(CTRL) && !/the how crowded of/.test(CTRL))
check('website links name the address', !/<Globe size=\{11\} \/> Website <ExternalLink/.test(OUT + read('components/labs/TrybeBrandPeek.tsx')) && /\{siteName\(b\.website\)\}/.test(OUT))
check('the New preset says what it lists', /label: 'New on TRYBE', says: 'Joined TRYBE in the last 30 days, or new to MVP in the last 14/.test(CTRL))

// Seb, 2026-10-24: "3 reviews minimum" for Star brands' rating and ranking.
{
  const BP = read('lib/brand-popularity.ts')
  check('a rating and ads per review count from 3 reviews', /export const STAR_MIN_REVIEWS = 3/.test(BP) && /reviews < STAR_MIN_REVIEWS\) return null/.test(BP) && /rating: \(ratingOf\(x\.r\)\?\.reviews \?\? 0\) >= STAR_MIN_REVIEWS/.test(ROUTE) && /A rating counts from 3 reviews/.test(read('components/labs/TrybeStarBrands.tsx')))
}

if (fails.length) { console.error('trybe-find-cleanup failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-find-cleanup: Find brands ranks real signals, the refresh counts every brand and says when it has, unknowns say where they come from')
