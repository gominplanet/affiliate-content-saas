// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STAR BRANDS AND HOW KNOWN A BRAND IS (Seb, 2026-10-21: "brands that have
// the least amount of creators, the most amount of active meta ads ... look
// at the website's brand and see the traffic ... a Tribe rating of over 90";
// then "a fourth button that basically has a new page").
//
// Held on what that day showed: GentGolfers, about 2,100 Meta ads running,
// ranked #3,257,281 among the world's websites and climbing from #4,403,044
// over 8 days, with ten Google suggestions starting with its name. Pure
// pieces are run; the wiring is read.
import { readFileSync, existsSync } from 'node:fs'
import { siteDomain, readRanks, webRankWords, googleSeed, brandSearches, googleWords, adsPerCreator, adsPerCreatorWords } from '../lib/brand-popularity'
import { filterCheck, readFilters, type FilterRow } from '../lib/trybe-finder'
import { BROWSE_SORTS } from '../lib/trybe-outreach'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The brand's own website ──────────────────────────────────────────────────
check('the brand\'s own domain, as the world\'s ranking counts it', siteDomain('https://www.gentgolfers.com/collections/all?utm_source=x') === 'gentgolfers.com' && siteDomain('shop.brand.co.uk') === 'brand.co.uk' && siteDomain('store.brand.com') === 'brand.com', [siteDomain('https://www.gentgolfers.com/'), siteDomain('shop.brand.co.uk')])
check('a page on someone else\'s site is never ranked as the brand (amazon.com is #10, not the brand)', [
  'https://www.amazon.com/stores/Brand/page/123', 'linktr.ee/brand', 'brand.myshopify.com', 'https://www.etsy.com/shop/Brand', 'instagram.com/brand', 'https://brand.wixsite.com/home', 'jointrybe.com/brand',
].every((u) => siteDomain(u) === null) && siteDomain(null) === null && siteDomain('') === null)

// ── Its rank among the world's websites ─────────────────────────────────────
const gent = readRanks({ domain: 'gentgolfers.com', ranks: [{ date: '2026-10-20', rank: 3257281 }, { date: '2026-10-19', rank: 3461091 }, { date: '2026-10-12', rank: 4403044 }] })
check('the latest rank, and the earliest with the days between', gent?.rank === 3257281 && gent?.was === 4403044 && gent?.days === 8, gent)
check('no ranks in the answer is "not ranked", not "not read"', JSON.stringify(readRanks({ domain: 'oinkblue.com', ranks: [] })) === JSON.stringify({ rank: null, was: null, days: null }) && readRanks('nonsense') === null)
const gentSaid = webRankWords({ checked: true, domain: 'gentgolfers.com', ...gent! })
check('a climbing site says so, with where it was', !!gentSaid && /climbing/.test(gentSaid.short) && /Up from #4,403,044 8 days earlier/.test(gentSaid.long) && gentSaid.tone === 'good', gentSaid)
check('it is called a rank, never visits', /A rank, not a visit count/.test(gentSaid?.long || '') && !/\bvisits\b/i.test(gentSaid?.short || ''))
const big = webRankWords({ checked: true, domain: 'ridge.com', rank: 42_000, was: null, days: null })
check('the top bands read as real traffic', big?.short === 'Website top 100K' && big.tone === 'good' && webRankWords({ checked: true, domain: 'x.com', rank: 640_000 })?.short === 'Website top 1M', big)
check('not ranked, a shared site, and not read are three different things', /few visitors/.test(webRankWords({ checked: true, domain: 'oinkblue.com', rank: null })?.short || '') && /shared site/.test(webRankWords({ checked: true, domain: null, rank: null })?.short || '') && webRankWords({ checked: false, domain: 'a.com', rank: null }) === null)

// ── Google's suggestions ─────────────────────────────────────────────────────
check('Google is asked the name the way people type it', googleSeed('GentGolfers') === 'gent golfers' && googleSeed('Ridge Inc.') === 'ridge' && googleSeed('TikTok') === 'tiktok', [googleSeed('GentGolfers'), googleSeed('Ridge Inc.'), googleSeed('TikTok')])
const gentPhrases = ['gent golfers', 'gent golfers glove', 'gent golfers glove review', 'gent golfers review', 'gent golfers discount code', 'gent golfers phone number', 'gent golfers website', 'gent golfers reddit', 'gent golfers reviews and complaints', 'gent golfers customer service number']
check('searches that start with its name count, joined or spaced', brandSearches('GentGolfers', gentPhrases).length === 10 && brandSearches('Gent Golfers', ['gentgolfers glove']).length === 1)
check('another word that starts the same is not its name ("ridgeback dog" for Ridge)', JSON.stringify(brandSearches('Ridge', ['ridge wallet', 'ridgeback dog', 'ridgeline', 'ridge'])) === JSON.stringify(['ridge wallet', 'ridge']))
check('Google correcting the name to something else counts nothing ("pink blue" for Oink Blue)', brandSearches('Oink Blue', ['pink blueberries', 'pink blue']).length === 0 && brandSearches('ab', ['ab roller']).length === 0)
const searched = googleWords({ checked: true, searches: 10, phrases: brandSearches('GentGolfers', gentPhrases) })
check('searched says so with examples, and that ten is the most Google shows', searched?.short === 'Searched on Google' && /“gent golfers”/.test(searched.long) && /up to ten/.test(searched.long), searched)
check('none, and not read, differ', googleWords({ checked: true, searches: 0 })?.short === 'Few Google searches' && googleWords({ checked: false, searches: null }) === null && googleWords({ checked: true, searches: null }) === null)

// ── Ads per creator ──────────────────────────────────────────────────────────
check('Meta ads for each creator, no creators counting as one', adsPerCreator(2100, 30) === 70 && adsPerCreator(5, 3) === 1.7 && adsPerCreator(12, 0) === 12 && adsPerCreator(0, 4) === 0)
check('a count not read is not a ratio of zero', adsPerCreator(null, 5) === null && adsPerCreator(40, null) === null)
check('in words, with both numbers', /70 Meta ads per creator/.test(adsPerCreatorWords(2100, 30).short) && /2,100 Meta ads running now and 30 creators/.test(adsPerCreatorWords(2100, 30).long) && /no creators yet/.test(adsPerCreatorWords(12, 0).long))

// ── TRYBE score 90 or more ──────────────────────────────────────────────────
const row = (score: number | null): FilterRow => ({ perVideo: null, creators: 10, stats: {} as FilterRow['stats'], earningsBucket: null, amazon: null, starred: false, score })
const f = readFilters({ minScore: 90 })
check('the TRYBE score filter is read, and kept to 100', f.minScore === 90 && readFilters({ minScore: 250 }).minScore === 100 && readFilters({}).minScore === null)
check('90 or more passes, under fails', filterCheck(row(92), f).pass && !filterCheck(row(85), f).pass)
check('a brand TRYBE gives no score is left out and counted, never listed as passing', (() => { const c = filterCheck(row(null), f); return !c.pass && c.blank.includes('minScore') })())

// ── Wiring ───────────────────────────────────────────────────────────────────
const ROUTE = read('app/api/labs/trybe/route.ts')
check('the list can be ranked by ads per creator, an uncounted brand after', (BROWSE_SORTS as readonly string[]).includes('adsPerCreator') && /sort === 'adsPerCreator' \? perCreator\(b\) - perCreator\(a\)/.test(ROUTE) && /\?\? -1\n/.test(ROUTE.slice(ROUTE.indexOf('const perCreator'), ROUTE.indexOf('const perCreator') + 400)))
check('the server says how much of the list was read, over every brand matched', /readCounts = \{\s*total: shown\.length,\s*meta: shown\.filter\(x => metaFresh\(x\.r\)\)\.length/.test(ROUTE) && /const metaTodo = sort === 'adsPerCreator'/.test(ROUTE) && /score: typeof x\.r\.trybe_score === 'number'/.test(ROUTE))
check('the popularity columns never break the list before migration 452', /COLS = BASE_COLS \+ PICK_COLS\n/.test(ROUTE))
const CRON = read('app/api/cron/trybe-directory/route.ts')
check('read in the background: Tranco one question a second, Google, highest TRYBE score first', /const TRANCO_GAP_MS = 1_100/.test(CRON) && /await fetchWebRank\(domain\)/.test(CRON) && /await suggest\('google', seed, sb\)/.test(CRON) && /order\('trybe_score', \{ ascending: false, nullsFirst: false \}\)\.limit\(POP_PER_RUN\)/.test(CRON))
check('a source that did not answer leaves the brand not read, and stops after two misses', /if \(!rank\) \{ run\.web\.missed\+\+; missedInRow\+\+/.test(CRON) && /missedInRow >= 2/.test(CRON) && /if \(!s\.answered\) \{ run\.google\.missed\+\+/.test(CRON))
const UI = read('components/labs/TrybeOutreach.tsx')
check('Star brands is a fourth button under Get brands, with its own page', /\{ id: 'stars', label: 'Star brands', icon: Rocket, group: 'brands', color: '#C026D3'/.test(UI) && /\{ id: 'stars', label: 'Star brands', icon: Rocket, group: 'brands', says:/.test(UI) && /tab === 'stars' && !lockedTab && \(\s*<TrybeStarBrands/.test(UI))
check('Find brands has the same sort, and counts the next brands for it', /\{ id: 'adsPerCreator', label: 'Most ads per creator'/.test(UI) && /sortBy === 'adsPerCreator' && live\?\.metaTodo/.test(UI) && /<PopularityChips b=\{b\} perCreator=\{sortBy === 'adsPerCreator'\} \/>/.test(UI))
const STARS = read('components/labs/TrybeStarBrands.tsx')
check('the page asks for TRYBE score 90 or more, ranked by ads per creator', /useState<number \| null>\(90\)/.test(STARS) && /sort: 'adsPerCreator'/.test(STARS) && /filters: \{ \.\.\.NO_FILTERS, minScore, maxCreators \}/.test(STARS))
check('it says how many were counted before the list, and marks the uncounted ones', /Meta ads counted for \{c\.meta\.toLocaleString\(\)\} of \{c\.total\.toLocaleString\(\)\}/.test(STARS) && /Meta ads not counted yet/.test(STARS) && /Count Meta ads for the next/.test(STARS))
check('migration 452 is there and safe to run twice', existsSync('supabase/migrations/452_trybe_brand_popularity.sql') && (() => { const m = read('supabase/migrations/452_trybe_brand_popularity.sql'); return (m.match(/add column if not exists/g) || []).length === 8 && !/drop |alter column/i.test(m) })())
// The words themselves: quoted strings and JSX text, never the code around them.
const words = (src: string) => (src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n').match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) || []).join(' ')
check('no dashes in what the creator reads', !/[–—]| - /.test(words(read('lib/brand-popularity.ts'))) && !/[–—]| - /.test(words(STARS)))

if (fails.length) { console.error('brand-popularity failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ brand-popularity: Star brands ranks TRYBE score 90+ by Meta ads per creator, says how much was counted, and shows each website\'s rank and Google searches, never a rank as visits or a miss as zero')
