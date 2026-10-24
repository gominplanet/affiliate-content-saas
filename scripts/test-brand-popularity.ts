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
import { siteDomain, readRanks, webRankWords, googleSeed, brandSearches, googleWords, adsPerCreator, adsPerCreatorWords, adsPerReview, adsPerReviewWords } from '../lib/brand-popularity'
import { filterCheck, readFilters, ratingOf, spendingOf, type FilterRow } from '../lib/trybe-finder'
import { metaOwnOf, metaTrustOf, metaUsable, metaTrustWords, sameAsBefore } from '../lib/trybe-pick'
import { BROWSE_SORTS } from '../lib/trybe-outreach'
import { byBrandName } from '../lib/trybe-mybrands'

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
check('Meta ads per review: a brand with no reviews has no ratio, never one over zero reviews', adsPerReview(2100, 37) === 57 && adsPerReview(30, 10) === 3 && adsPerReview(40, 0) === null && adsPerReview(40, null) === null && adsPerReview(null, 10) === null)
check('per review in words says reviews are a floor, not a creator count', /57 Meta ads per review/.test(adsPerReviewWords(2100, 37).short) && /at least that many worked with it/.test(adsPerReviewWords(2100, 37).long))
check('in words, with both numbers', /70 Meta ads per creator/.test(adsPerCreatorWords(2100, 30).short) && /2,100 Meta ads running now and 30 creators/.test(adsPerCreatorWords(2100, 30).long) && /no creators yet/.test(adsPerCreatorWords(12, 0).long))

// ── TRYBE rating 4.5 stars or more (Seb's "over 90") ─────────────────────────
// Seb's check, 2026-10-21: TRYBE's list has no score out of 100. Its rating is
// reviewRating, creators' stars of 5 (3.1 to 4.9), with reviewCount, on 604 brands.
const row = (rating: number | null): FilterRow => ({ perVideo: null, creators: 10, stats: {} as FilterRow['stats'], earningsBucket: null, amazon: null, starred: false, rating })
const f = readFilters({ minRating: 4.5 })
check('the rating filter is read in stars, kept to 5', f.minRating === 4.5 && readFilters({ minRating: 9 }).minRating === 5 && readFilters({}).minRating === null)
check('4.5 stars or more passes, under fails', filterCheck(row(4.8), f).pass && filterCheck(row(4.5), f).pass && !filterCheck(row(4.4), f).pass)
check('a brand with no reviews yet is left out and counted, never listed as passing', (() => { const c = filterCheck(row(null), f); return !c.pass && c.blank.includes('minRating') })())
check('TRYBE\'s own reviewRating and reviewCount are read from what MVP keeps', JSON.stringify(ratingOf({ rating: null, raw: { reviewRating: 4.8, reviewCount: 37 } })) === JSON.stringify({ stars: 4.8, reviews: 37 }) && ratingOf({ raw: { reviewRatingLabel: '4.2' } })?.stars === 4.2 && ratingOf({ raw: {} }) === null && ratingOf({ raw: { reviewRating: 48 } }) === null)
check('new collections keep it in the rating column', /rating: num\(pick\(raw, \['reviewRating', 'rating'/.test(read('lib/trybe-directory.ts')))

// ── Is the Meta count the brand's? (Seb's test, 2026-10-21: Loaded, Dose
// and Rest each read 50,000, Meta's most, because their names are words) ──
const card = (page: string, body = 'Rest better tonight with our mattress.') => ({ text: `Active\nLibrary ID: ${Math.floor(Math.random() * 1e12)}\nStarted running on Oct 1\nPlatforms\n${page}\nSponsored\n${body}` })
const others = [card('Sleep Number'), card('Purple'), card('Casper'), card('Tempur-Pedic'), card('Nectar Sleep'), card('Rest'), card('Saatva')]
check('of the ads SCOUT saw, the brand\'s own are the ones its page runs', JSON.stringify(metaOwnOf(others, 'Rest')) === JSON.stringify({ sample: 7, own: 1 }) && metaOwnOf([card('Gent Golfers'), card('GentGolfers'), card('Golf Galaxy')], 'GentGolfers').own === 2)
check('a word inside another advertiser\'s name is not the brand ("Restoration Hardware" for Rest)', metaOwnOf([card('Restoration Hardware'), card('Interest Rates Today')], 'Rest').own === 0)
check('Meta\'s most is "too many to count", mostly others is "mixed", mostly its own is "own", too few seen is "unchecked"',
  metaTrustOf({ count: 50000 }) === 'capped' && metaTrustOf({ count: 1240, own: 1, sample: 7 }) === 'mixed' && metaTrustOf({ count: 1240, own: 6, sample: 7 }) === 'own' && metaTrustOf({ count: 1240, own: 1, sample: 3 }) === 'unchecked' && metaTrustOf({ count: 0 }) === 'unchecked')
check('a count that is not the brand\'s is never its ad spend: Best bets, Spending on ads, the ratio', metaUsable({ meta_ads: 50000 }) === null && metaUsable({ meta_ads: 900, meta_ads_own: 1, meta_ads_sample: 10 }) === null && metaUsable({ meta_ads: 900, meta_ads_own: 9, meta_ads_sample: 10 }) === 900 && spendingOf({ meta_ads: 50000, meta_ads_checked_at: '2026-10-21' }) === null && spendingOf({ meta_ads: 12, meta_ads_checked_at: '2026-10-21' }) === true)
check('in words, with the name and what was seen', /\u201cRest\u201d/.test(metaTrustWords('capped', { name: 'Rest', count: 50000 })?.long || '') && /Of the 7 ads SCOUT saw for \u201cRest\u201d, 1 was the brand\u2019s own/.test(metaTrustWords('mixed', { name: 'Rest', count: 1240, own: 1, sample: 7 })?.long || '') && metaTrustWords('own', { name: 'Rest', count: 9 }) === null)
{
  const R = read('app/api/labs/trybe/route.ts'), M = read('components/labs/metaAdsRead.ts')
  check('every count is checked against the ads on the page, and kept (migration 453)', /requestMetaAdsCounts\(batch, true\)/.test(M) && /metaOwnOf\(x\.cards as Array<\{ text\?: unknown \}>, x\.name\)/.test(M) && /update\(\{ meta_ads_own: own, meta_ads_sample: sample \}\)/.test(R) && /opts\.cards && Array\.isArray\(x\.cards\) \? \{ cards: x\.cards \}/.test(M))
  check('a count that is not the brand\'s ranks after real counts, gets no ratio, and is said', /if \(!trusted\(x\.r\)\) return \[1, 0\]/.test(R) && /ads_per_review: metaFresh\(r\) && trusted\(r\)/.test(R) && /metaAds: [^\n]*\? metaUsable\(r\) : null/.test(R) && /Counts that include other advertisers&rsquo; ads/.test(read('components/labs/TrybeStarBrands.tsx')))
  check('old counts never checked are counted again first, then the never counted', /r\.meta_ads_sample == null && \(r\.meta_ads \?\? 0\) > 0 \? 0 : !r\.meta_ads_checked_at \? 1/.test(R) && /todoRank\(a\.r\) - todoRank\(b\.r\)/.test(R))
  // Seb, 2026-10-21: SkyMD read 680 ads, its Ad Library link shows none.
  check('a count word for word the same as the brand read just before it is not saved, and is said', sameAsBefore('~680 results', '~680 results', 680) && !sameAsBefore('~680 results', '~690 results', 690) && !sameAsBefore('No ads match', 'No ads match', 0) && !sameAsBefore('~50,000 results', '~50,000 results', 50000) && !sameAsBefore(null, '~680 results', 680) && /const doubled = sameAsBefore\(prevText, x\.text, count\)/.test(M) && /if \(doubled\) run\.doubled\+\+/.test(M) && /counted again next time/.test(M))
}

// ── Count all, and the team's daily refresh (Seb, 2026-10-21) ────────────────
{
  const STARS2 = read('components/labs/TrybeStarBrands.tsx'), UI2 = read('components/labs/TrybeOutreach.tsx'), R = read('app/api/labs/trybe/route.ts')
  check('Count all goes through every brand, ranks again after every 40, and stops on Stop', /readMetaAdsAll\(todo\.map/.test(STARS2) && /onChunk: all \? \(\) => load\(\) : undefined/.test(STARS2) && /stopRef\.current = true/.test(STARS2) && /Count all \{todo\.toLocaleString\(\)\}/.test(STARS2) && /\.slice\(0, starPool \? 3000 : 120\)/.test(R))
  check('the daily refresh is the team\'s, next to Join free, and runs the list, the Top 100 and Meta ads in turn', /\{isAdmin && !preview && \(\s*daily\?\.running/.test(UI2) && UI2.indexOf('New to TRYBE? Join free') < UI2.indexOf('<RotateCcw size={12} /> Daily refresh') && /await collectFromTrybe\(notes, true\)/.test(UI2) && /const t = await readTop100\(false, true\)/.test(UI2) && /\.slice\(0, DAILY_META_CHUNK\)/.test(UI2))
  // Seb, 2026-10-21: "keep it running until everything is counted ... if I stop it, can it resume where it was".
  check('the daily refresh counts every brand until none are left or Stop, and picks up where it stopped', /for \(;;\) \{/.test(UI2) && /if \(!todo\.length\) break/.test(UI2) && /filter\(\(b\) => !tried\.has\(b\.brand_id\)\)/.test(UI2) && /it picks up the brands not counted yet/.test(UI2) && /metaLeft = typeof count === 'number' \? count : null/.test(R))
  check('a press within 12 hours goes straight back to counting', /const DAILY_FRESH_MS = 12 \* 3600_000/.test(UI2) && /step\('list', 'skipped', `Collected \$\{ago\(directory\.lastCollectedAt\)\}: not needed again yet\.`\)/.test(UI2) && /step\('top100', 'skipped', `Read \$\{ago\(directory\.top100\.at\)\}/.test(UI2))
  check('each step says what it did or why not, and the run is kept for the next visit', /step\('meta', w\.tone === 'ok' \? 'done'/.test(UI2) && /action: 'daily_refresh', log:/.test(UI2) && /if \(action === 'daily_refresh'\) \{\s*if \(tier !== 'admin'\)/.test(R) && /More than a day ago/.test(UI2))
  // Seb, 2026-10-21: "go to their website directly or to their tribe page directly ... what happens if we click on their little star?"
  check('each brand links to TRYBE, its website and its Meta ads, each naming where it goes, and says if the count was checked', /<TrybeLink brandId=\{b\.brand_id\} name=\{b\.name\} scout=\{scoutOpens\} label=\{`\$\{b\.name\} on TRYBE`\} \/>/.test(STARS2) && /Its website, \{hostOf\(b\.website\)\}/.test(STARS2) && /Its ads in Meta&rsquo;s Ad Library/.test(STARS2) && /Checked: \$\{b\.meta_ads_own\} of the \$\{b\.meta_ads_sample\} ads SCOUT saw are its own/.test(STARS2) && /scoutOpens=\{scoutOpens\} \/>/.test(UI2))
  check('the page says where a star keeps a brand', /The star keeps a brand on your Starred list: Find brands, Filters, Starred/.test(STARS2))
  // Seb, 2026-10-22: "if my Trybe account is not open or scout is not running.. this should be automatic" (his run: 401 on the list).
  check('the daily refresh makes TRYBE ready first: allowed, a tab opened by itself, the sign-in waited for', /const ready = await trybeReady\(/.test(UI2) && /async function trybeReady\(/.test(UI2) && /requestTrybeTabOpen\(false\)/.test(UI2.slice(UI2.indexOf('async function trybeReady('))) && /The refresh carries on by itself once you are/.test(UI2) && /Date\.now\(\) \+ 15 \* 60_000/.test(UI2))
  check('the Top 100 goes before the list, and a list refused for the sign-in is asked again after renewing it', UI2.indexOf("step('top100', 'running'") < UI2.indexOf("step('list', 'running', 'SCOUT is collecting") && /refused the brand list with your sign-in/.test(UI2) && /await renewTrybeSignIn\(\)/.test(UI2) && /requestTrybeApi\('GET', '\/backend\/api\/creator\/v2\/top-creatives'\)/.test(UI2.slice(UI2.indexOf('async function renewTrybeSignIn('))))
  check('not ready says why and starts nothing else', /stopRest\(\['top100', 'list', 'meta'\], 'Not started: TRYBE was not ready\.'\)/.test(UI2))
  check('migration 453 is there and safe to run twice', existsSync('supabase/migrations/453_trybe_meta_own.sql') && (read('supabase/migrations/453_trybe_meta_own.sql').match(/add column if not exists/g) || []).length === 2)
}

// ── Wiring ───────────────────────────────────────────────────────────────────
const ROUTE = read('app/api/labs/trybe/route.ts')
check('the list can be ranked by ads per creator, an uncounted brand after', (BROWSE_SORTS as readonly string[]).includes('adsPerCreator') && /sort === 'adsPerCreator' \? adsOrder\(a, b\)/.test(ROUTE) && /if \(!metaFresh\(x\.r\)\) return \[0, 0\]/.test(ROUTE) && /return ratio != null \? \[3, ratio\] : \[2, x\.r\.meta_ads as number\]/.test(ROUTE))
check('the server says how much of the list was read, over every brand matched', /readCounts = \{[\s\S]{0,700}?total: shown\.length,\s*meta: shown\.filter\(x => metaFresh\(x\.r\)\)\.length/.test(ROUTE) && /const metaTodo = sort === 'adsPerCreator'/.test(ROUTE) && /rating: ratingOf\(x\.r\)\?\.stars \?\? null \}, filters\)/.test(ROUTE))
check('the popularity columns never break the list before migration 452', /for \(const cols of \[BASE_COLS \+ PICK_COLS \+ POP_COLS \+ OWN_COLS, BASE_COLS \+ PICK_COLS \+ POP_COLS, BASE_COLS \+ PICK_COLS\]\)/.test(ROUTE))
const CRON = read('app/api/cron/trybe-directory/route.ts')
check('read in the background: Tranco one question a second, Google, highest TRYBE score first', /const TRANCO_GAP_MS = 1_100/.test(CRON) && /await fetchWebRank\(domain\)/.test(CRON) && /await suggest\('google', seed, sb\)/.test(CRON) && /not\('raw->>reviewRating', 'is', null\)\.limit\(POP_PER_RUN\)/.test(CRON))
check('a source that did not answer leaves the brand not read, and stops after two misses', /if \(!rank\) \{ run\.web\.missed\+\+; missedInRow\+\+/.test(CRON) && /missedInRow >= 2/.test(CRON) && /if \(!s\.answered\) \{ run\.google\.missed\+\+/.test(CRON))
const UI = read('components/labs/TrybeOutreach.tsx')
check('Star brands is a fourth button under Get brands, with its own page', /\{ id: 'stars', label: 'Star brands', icon: Rocket, group: 'brands', color: '#C026D3'/.test(UI) && /\{ id: 'stars', label: 'Star brands', icon: Rocket, group: 'brands', says:/.test(UI) && /tab === 'stars' && !lockedTab && \(\s*<TrybeStarBrands/.test(UI))
check('Find brands has the same sort, and counts the next brands for it', /\{ id: 'adsPerCreator', label: 'Most ads per creator'/.test(UI) && /sortBy === 'adsPerCreator' && live\?\.metaTodo/.test(UI) && /<PopularityChips b=\{b\} perCreator=\{sortBy === 'adsPerCreator'\} \/>/.test(UI))
const STARS = read('components/labs/TrybeStarBrands.tsx')
check('the page asks for 4.5 stars or more, ranked by ads per creator', /useState<number \| null>\(4\.5\)/.test(STARS) && /sort: 'adsPerCreator'/.test(STARS) && /filters: \{ \.\.\.NO_FILTERS, minRating, maxCreators \}/.test(STARS) && /4\.5 of 5 stars is 90%/.test(STARS))
// Seb's check, 2026-10-21: TRYBE's list gave no creator count for any of 7,378 brands.
// Seb, 2026-10-21: "ok do meta ads per review".
check('with no creator counts it ranks by Meta ads per review and says why, never calling a counted brand not counted', /: adsPerReview\(r\.meta_ads, ratingOf\(r\)\?\.reviews \?\? null\)/.test(ROUTE) && /rankedBy: creatorsKnown \? 'perCreator' as const : 'perReview' as const/.test(ROUTE) && /Ranked by Meta ads per creator review/.test(STARS) && /Meta ads per review<\/span>/.test(STARS) && /const known = !!b\.meta_fresh/.test(STARS) && /meta_fresh: !!metaFresh\(r\)/.test(ROUTE) && /label: 'Most ads per review'/.test(UI))
check('every rated brand is in the starting set when the rating filter is on', /not\('raw->>reviewRating', 'is', null\)/.test(ROUTE))
check('it says how many were counted before the list, and marks the uncounted ones', /Meta ads counted for \{c\.meta\.toLocaleString\(\)\} of \{c\.total\.toLocaleString\(\)\}/.test(STARS) && /Meta ads not counted yet/.test(STARS) && /Count the next \{Math\.min\(COUNT_PER_PRESS, todo\)\}/.test(STARS))
// Seb's check, 2026-10-21: none of 7,378 brands had TRYBE's score in MVP's copy.
check('with no keyword, Star brands starts from every counted brand, then the likeliest to count next, never 1,000 in no order', /const starPool = !direct && !words\.length && sort === 'adsPerCreator'/.test(ROUTE) && /gte\('meta_ads_checked_at', fresh\)/.test(ROUTE) && /order\('top100_hits', \{ ascending: false, nullsFirst: false \}\)/.test(ROUTE) && /direct \|\| starPool \? \{ data: null, error: null \}/.test(ROUTE))
check('no rating anywhere takes the rating filter off and says why, never "no brand matches"', /ratingKnown: rows\.filter\(r => ratingOf\(r\) != null\)\.length/.test(ROUTE) && /a\.readCounts\.ratingKnown === 0/.test(STARS) && /setMinRating\(null\)/.test(STARS) && /TRYBE&rsquo;s rating is not in MVP&rsquo;s copy of TRYBE/.test(STARS))
// THE PAGE GETS WHAT IT READS (2026-10-21): Find brands copies the server's
// answer field by field, and Your mix, the spend note, the crowd window and
// the read counts were read but never copied, so they never showed.
{
  const block = UI.slice(UI.indexOf('setLive({ brands: d.brands'), UI.indexOf('// The saved priorities, until the creator changes them'))
  const readKeys = Array.from(new Set(Array.from(UI.matchAll(/\blive\??\.(\w+)/g)).map((m) => m[1]))).filter((k) => !['brands', 'matched', 'capped'].includes(k))
  const missing = readKeys.filter((k) => !new RegExp(`\\b${k}: d\\.${k}\\b`).test(block))
  check('every answer field Find brands reads is copied into the page', block.length > 100 && missing.length === 0, missing)
}
check('no creator counts from TRYBE is said on Fewest creators, the creator limit, the quick list and Best bets', /creatorsKnown,/.test(ROUTE) && /Fewest creators \(no counts yet\)/.test(UI) && /cannot narrow the list/.test(UI) && /noCreators=\{live\?\.creatorsKnown === false\}/.test(UI) && /this part is not read for any brand yet/.test(UI) && /creators \(no counts from TRYBE yet\)/.test(read('components/labs/TrybeFinderControls.tsx')))
check('migration 452 is there and safe to run twice', existsSync('supabase/migrations/452_trybe_brand_popularity.sql') && (() => { const m = read('supabase/migrations/452_trybe_brand_popularity.sql'); return (m.match(/add column if not exists/g) || []).length === 8 && !/drop |alter column/i.test(m) })())
// The words themselves: quoted strings and JSX text, never the code around them.
const words = (src: string) => (src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n').match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) || []).join(' ')
check('no dashes in what the creator reads', !/[–—]| - /.test(words(read('lib/brand-popularity.ts'))) && !/[–—]| - /.test(words(STARS)))

// Seb, 2026-10-22: "this list of brands we work with should be in alphabetical order".
{
  const order = ['Chef Preserve', 'audien', 'Aero AI', 'BRYN', 'Bat Tan'].map((name) => ({ name })).sort(byBrandName).map((x) => x.name).join(',')
  check('brands you work with are listed A to Z, capitals ignored', order === 'Aero AI,audien,Bat Tan,BRYN,Chef Preserve', order)
  check('in Upload videos, Make videos and This week', /\[\.\.\.brands\]\.sort\(byBrandName\)\.map/.test(read('components/labs/DropTrybePicker.tsx')) && /\.sort\(byBrandName\), \[brands, q\]\)/.test(read('components/labs/TrybeCreate.tsx')) && /\[\.\.\.\(joined \|\| \[\]\)\]\.sort\(byBrandName\)/.test(read('components/labs/TrybeWeek.tsx')))
}

if (fails.length) { console.error('brand-popularity failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ brand-popularity: Star brands ranks brands rated 4.5 stars+ by Meta ads per creator (per creator review while TRYBE gives no creator counts), says how much was counted, and shows each website\'s rank and Google searches, never a rank as visits or a miss as zero')
