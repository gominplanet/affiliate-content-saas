// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A TRYBE BRAND PAYS CREATORS A MONTH (lib/trybe-finder creatorSpendOf;
// Seb, 2026-10-16: "for Trybe, could we find out ad spend budget each brand
// has monthly?"). No platform publishes a brand's ad budget, so MVP works out
// what it honestly can: videos approved in the last 30 days times its pay per
// approved video. Held on the traps: a missing pay figure or a missing 30 day
// count is no estimate (never a guess, never $0), a 12 day window is scaled
// to a month and says so, no videos lately is a real $0 and says so, and
// under the filter a brand with no estimate is left out and counted.
import { readFileSync } from 'node:fs'
import { creatorSpendOf, filterCheck, readFilters, readDirStats, FILTER_WORDS } from '../lib/trybe-finder'
import { BROWSE_SORTS } from '../lib/trybe-outreach'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const full = creatorSpendOf({ crowd: { newVideos: 40, days: 30 }, perVideo: 50, basis: 'terms' })
check('40 videos a month at $50 is about $2,000 a month', full.dollars === 2000 && full.videos === 40 && full.short === '~$2K/mo to creators', full)
check('it says how it was worked out, from what, and that it is an estimate', /40 videos approved a month, about \$50 each \(from its pay terms on TRYBE\)/.test(full.why) && /An estimate/.test(full.why), full.why)
check('it says pay on top is not in it', /% of sales or of ad spend, is not in it/.test(full.why))
check('it is never for a message to a brand', /never put it in a message to a brand/.test(full.why))

const short = creatorSpendOf({ crowd: { newVideos: 12, days: 12 }, perVideo: 30, basis: 'members' })
check('a 12 day window is scaled to 30 and says so', short.videos === 30 && short.dollars === 900 && /Counted over 12 days and scaled to 30\./.test(short.why) && /members/.test(short.why), short)

const noPay = creatorSpendOf({ crowd: { newVideos: 40, days: 30 }, perVideo: null })
check('no pay per video is no estimate, never a guess', noPay.dollars === null && noPay.short === null && /No pay per approved video/.test(noPay.why), noPay)
const noCount = creatorSpendOf({ crowd: { newVideos: null, days: null }, perVideo: 50 })
check('no 30 day count is no estimate', noCount.dollars === null && /does not yet know how many videos/.test(noCount.why), noCount)
check('no crowd read at all is no estimate', creatorSpendOf({ crowd: null, perVideo: 50 }).dollars === null)
check('a window under a week is not a month', creatorSpendOf({ crowd: { newVideos: 5, days: 3 }, perVideo: 50 }).dollars === null)
const quiet = creatorSpendOf({ crowd: { newVideos: 0, days: 30 }, perVideo: 50 })
check('no videos lately is a real $0, said in words', quiet.dollars === 0 && /No videos approved in the last 30 days/.test(quiet.why), quiet)
check('big figures read short', creatorSpendOf({ crowd: { newVideos: 300, days: 30 }, perVideo: 75 }).short === '~$23K/mo to creators' && creatorSpendOf({ crowd: { newVideos: 3, days: 30 }, perVideo: 75 }).short === '~$225/mo to creators')

// UNTIL MVP HAS 30 DAYS (Seb, 2026-10-16: "i'm not seeing what it would say
// next to each brand"): MVP's daily copies began Oct 14 and the 30 days need
// a week of them, so every brand read blank. The brand's average since it
// joined TRYBE fills in, from what TRYBE shows creators earned with it.
const NOW = Date.parse('2026-10-16T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const life = creatorSpendOf({ crowd: { newVideos: null, days: null }, perVideo: null, earned: 24_000, joinedAt: ago(365), now: NOW })
check('a year on TRYBE and $24K earned by creators is about $2K a month on average', life.basis === 'lifetime' && life.dollars === Math.round(24_000 / (365 / 30.44)) && life.short === '~$2K/mo avg to creators' && /since it joined TRYBE 12 months ago/.test(life.why) && /this month may be higher or lower/.test(life.why), life)
const floor = creatorSpendOf({ crowd: null, perVideo: 40, earned: 10_000, earnedFloor: true, joinedAt: ago(100), now: NOW })
check('TRYBE\u2019s bucket is a floor and says so', floor.dollars === Math.round(10_000 / (100 / 30.44)) && floor.short === '$3K+/mo avg to creators' && /^At least/.test(floor.why) && /at least \$10,000/.test(floor.why), floor)
const young = creatorSpendOf({ crowd: null, perVideo: null, earned: 900, joinedAt: ago(20), now: NOW })
check('under a month on TRYBE: what it paid so far, never scaled up', young.dollars === 900 && /20 days ago/.test(young.why), young)
check('under two weeks on TRYBE is too soon to average', creatorSpendOf({ crowd: null, perVideo: null, earned: 900, joinedAt: ago(10), now: NOW }).dollars === null)
check('no join date is no average, and says why', (() => { const r = creatorSpendOf({ crowd: null, perVideo: null, earned: 5000, joinedAt: null, now: NOW }); return r.dollars === null && /no join date/.test(r.why) })())
const both = creatorSpendOf({ crowd: { newVideos: 40, days: 30 }, perVideo: 50, earned: 999_999, joinedAt: ago(365), now: NOW })
check('the last 30 days win over the average once MVP has them', both.basis === 'recent' && both.dollars === 2000, both)
check('the average is for choosing brands only too', /never put it in a message to a brand/.test(life.why))

// THE FILTER: like a pay minimum, no estimate is left out and counted apart.
const row = { perVideo: 50, creators: 10, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false }
const f = readFilters({ minSpend: 1000 })
check('the filter is read from the page', f.minSpend === 1000 && readFilters({ minSpend: 'x' }).minSpend === null)
check('pays $2,000: passes', filterCheck({ ...row, spend: 2000 }, f).pass)
check('pays $500: hidden, not blank', (() => { const c = filterCheck({ ...row, spend: 500 }, f); return !c.pass && c.failed.includes('minSpend') && !c.blank.includes('minSpend') })())
check('no estimate: hidden and counted as blank, never listed', (() => { const c = filterCheck({ ...row, spend: null }, f); return !c.pass && c.blank.includes('minSpend') })())
check('the filter has words for the note', FILTER_WORDS.minSpend === 'what it pays creators a month')

// THE WIRING
check('Pays creators most is a sort', (BROWSE_SORTS as readonly string[]).includes('spend'))
const ROUTE = read('app/api/labs/trybe/route.ts')
check('browse estimates every brand from its 30 days and its pay per video, else its earnings over its time on TRYBE', /crowd: crowdBy\.get\(r\.brand_id\), perVideo: estBy\.get\(r\.brand_id\)\?\.dollars \?\? null, basis: estBy\.get\(r\.brand_id\)\?\.basis \?\? null,/.test(ROUTE) && /earned: st\?\.paidOut \?\? bucket, earnedFloor: st\?\.paidOut == null && bucket != null, joinedAt: st\?\.joinedAt \?\? null,/.test(ROUTE))
check('the list says how many brands have a figure and from what', /spendKnown: \(\(\) => \{/.test(ROUTE) && /export function SpendNote/.test(read('components/labs/TrybeFinderControls.tsx')) && /<SpendNote known=\{live\.spendKnown\} windowDays=\{live\.crowdDays\} \/>/.test(read('components/labs/TrybeOutreach.tsx')) && /live\.spendKnown\.recent \+ live\.spendKnown\.lifetime === 0/.test(read('components/labs/TrybeOutreach.tsx')))
check('browse filters on it, sorts by it with no estimate after, and sends it', /spend: spendBy\.get\(x\.r\.brand_id\)\?\.dollars \?\? null,?[\s\S]{0,300}\}, filters\)/.test(ROUTE) && /sort === 'spend' \? spendOrder\(b\) - spendOrder\(a\)/.test(ROUTE) && /spendBy\.get\(x\.r\.brand_id\)\?\.dollars \?\? -1/.test(ROUTE) && /spend: spendBy\.get\(r\.brand_id\) \?\? null,/.test(ROUTE))
const CTRL = read('components/labs/TrybeFinderControls.tsx')
const PAGE = read('components/labs/TrybeOutreach.tsx')
check('the card shows it with the math in the hover, and nothing when not known', /export function SpendChip/.test(CTRL) && /if \(!spend \|\| spend\.dollars == null \|\| !spend\.short\) return null/.test(CTRL) && /title=\{spend\.why\}/.test(CTRL) && /<SpendChip spend=\{b\.spend\} \/>/.test(PAGE))
check('the filter box, the note and the preset are there', /numberBox\('minSpend', 'Pays creators \$', 'a month\+'/.test(CTRL) && /MVP cannot estimate yet \(no pay figure, or no count of its videos in the last 30 days\)/.test(CTRL) && /id: 'budgets', label: 'Big creator budgets'/.test(CTRL) && /minSpend: 1000 \}, sort: 'spend'/.test(CTRL))
check('the sort says what it is', /id: 'spend', label: 'Pays creators most'/.test(PAGE))
check('the words on screen have no dashes', ![full.why, short.why, noPay.why, noCount.why, quiet.why, life.why, floor.why, young.why].some((w) => /[–—]| - /.test(w)) && !/Big creator budgets'[^\n]*[–—]/.test(CTRL))

if (fails.length) { console.error('trybe-spend failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-spend: what a brand pays TRYBE creators a month, estimated from its 30 days and its pay per video; no figure is no estimate, never a guess')
