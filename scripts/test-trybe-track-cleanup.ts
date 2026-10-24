// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE TRACK, CLEANED UP (Seb, 2026-10-24: "take your time and fix all
// issues and illogical messes inside of the Trybe feature"). Holds what the
// review of My brands, Analytics and What changed found:
//   - members' combined numbers never include the asker, are rounded, never
//     say the exact count, count an approval rate only from fully read rows,
//     take a member's numbers once a day, and never keep an opted-out
//     member's numbers when the setting could not be read;
//   - Drop never rests on numbers that were not read;
//   - every figure says what it is (all time, out of sent or decided) and a
//     figure not read is "not read", never 0;
//   - reads past 1,000 rows are paged;
//   - What changed: yours are the brands you work with, counted as brands,
//     pay cuts are not green, tiers are not pay;
//   - only the MVP team's reads clear "left TRYBE" for everyone;
//   - a flat fee plus a percent on one line is two terms.
import { readFileSync } from 'node:fs'
import { poolBrands, POOL_MIN } from '../lib/trybe-changes'
import { judgeBrands } from '../lib/trybe-mybrands'
import { readTerms } from '../lib/trybe-pay'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const ROUTE = read('app/api/labs/trybe/route.ts')

// Pooling.
const row = (u: string, approved: number, rejected: number | null, earnings: number | null) => ({ user_id: u, brand_id: 'x', approved, rejected, earnings })
const six = [row('me', 1, 9, 10), row('a', 6, 4, 120), row('b', 5, 5, 100), row('c', 4, 6, 80), row('d', 5, 5, 100), row('e', 5, 5, 100)]
const withMe = poolBrands(six).get('x')!, noMe = poolBrands(six, { exclude: 'me' }).get('x')!
check('the asker\'s own row is never in what they see', noMe.approvalRate === 0.5 && withMe.approvalRate !== noMe.approvalRate)
check('the count is never exact once it shows', noMe.members === POOL_MIN && poolBrands([...six, row('f', 5, 5, 100)]).get('x')!.members === POOL_MIN)
check('figures are rounded: rates to 5 points, pay to $5', [row('a', 7, 3, 133), row('b', 5, 5, 101), row('c', 4, 6, 77), row('d', 5, 5, 103), row('e', 6, 4, 111)].length === 5 && (() => { const p = poolBrands([row('a', 7, 3, 133), row('b', 5, 5, 101), row('c', 4, 6, 77), row('d', 5, 5, 103), row('e', 6, 4, 111)]).get('x')!; return Math.round((p.approvalRate as number) * 100) % 5 === 0 && (p.payPerApproved as number) % 5 === 0 })())
check('a member whose rejections were not read is not counted at 100%', poolBrands([row('a', 9, null, 90), row('b', 5, 5, 50), row('c', 5, 5, 50), row('d', 5, 5, 50), row('e', 5, 5, 50)]).get('x')!.approvalRate == null)
check('fewer than five says why without the count', /Shown once 5 MVP members have results/.test(poolBrands([row('a', 5, 5, 50)]).get('x')!.why || '') && !/so far/.test(poolBrands([row('a', 5, 5, 50)]).get('x')!.why || ''))
check('the server leaves the asker out, reads the opt out on its own, and takes numbers once a day', /poolBrands\(pr, \{ exclude: ownerId \}\)/.test(ROUTE) && /poolBrands\(rows, \{ exclude: ownerId \}\)/.test(ROUTE) && /Your results were not saved: MVP could not read your setting just now/.test(ROUTE) && /return NextResponse\.json\(\{ ok: true, kept: 0, today: true \}\)/.test(ROUTE))
const MB = read('components/labs/TrybeMyBrands.tsx')
check('a failed save of your results is said next to the box', /Your results were not added this time/.test(MB) && /\{myStatsNote && /.test(MB))
check('the members line says 5+ and compares only like with like', /`\$\{POOL_MIN\}\+`/.test(MB) && /mine=\{j\.exactRate \? j\.rate : null\}/.test(MB))

// Drop.
const NOW = Date.parse('2026-10-24T12:00:00Z'), day = 86_400_000
const j = (b: Record<string, unknown>) => judgeBrands([{ id: 'zz000001', name: 'B', logo: null, programs: [], enrolledAt: new Date(NOW - 40 * day).toISOString(), ...b } as never], NOW)[0].verdict
check('videos in review never drop a brand', j({ earnings: 0, submitted: 10, approved: 2, pending: 8, rejected: null }) !== 'drop' && j({ earnings: 0, submitted: 6, approved: 0, pending: 6, rejected: 0 }) !== 'drop')
check('a rate from read numbers still drops', j({ earnings: 0, submitted: 11, approved: 1, pending: 0, rejected: 10 }) === 'drop')

// Words.
check('My brands says all time and never adds an unread figure as 0', /label="Earned on TRYBE, all time"/.test(MB) && /TRYBE gave no figure for/.test(MB) && /label="Earned, all time"/.test(MB))
check('both approval rates are named', /'Approved of sent' : 'Approved of decided'/.test(MB) && /Approval rate \(approved out of all sent\)/.test(read('components/labs/TrybeAds.tsx')))
const ADS = read('components/labs/TrybeAds.tsx')
check('one brand not read is "not read", never 0', /const oneUnread = !!brand && \(!oneSubs \|\| !oneSubs\.read\)/.test(ADS) && /subs\.read && !oneUnread/.test(ADS))
check('ad videos or totals not read are said, never "no ads"', /read\.videosRead !== false/.test(ADS) && /TRYBE&rsquo;s totals did not answer/.test(ADS) && /if \(ads\.videosRead === false\)/.test(MB))
// THE AD VIDEOS (Seb, 2026-10-24: "not loading here", on Analytics and on
// every My brands card). Asked more than one way, taken from the totals
// answer when it carries the list, and when they still do not read, TRYBE's
// own answer is said: once on My brands, not on every card.
{
  const HOOK = read('components/labs/useTrybeAds.ts')
  check('the ad videos are asked with the sort TRYBE requires', /sort: 'earnings' \| 'hook' = 'earnings'/.test(HOOK) && /analytics\/submissions\?period=\$\{period\}&sort=\$\{sort\}`/.test(HOOK))
  check('the ad videos are asked at 100, 50 and no page size, stopping at signed out or not found', /\[`\$\{base\}&limit=100`, `\$\{base\}&limit=50`, base\]/.test(HOOK) && /last\.status === 401 \|\| last\.status === 403 \|\| last\.status === 404\) break/.test(HOOK))
  check('a videos list in the totals answer stands in, and only a list with videos', /const fromTotals = !v\.ok && t\.ok \? readAdVideos\(t\.json\) : \[\]/.test(HOOK) && /const videosRead = \(v\.ok && !unreadForm\) \|\| fromTotals\.length > 0/.test(HOOK))
  check('a list MVP finds no videos in while TRYBE counts live ads is said as unread, never "no ads"', /const unreadForm = v\.ok && videos\.length === 0 && liveCounted > 0/.test(HOOK) && /in a form MVP does not read yet/.test(HOOK))
  check('why the videos did not read is said in TRYBE\'s words', /videosWhy: videosRead \? null : unreadForm \? \(rowsSent === 0 \?/.test(HOOK) && /in a form MVP does not read yet: \$\{keysOf\(v\.json\)\}`\) : whyNot\(v\)/.test(HOOK) && /TRYBE answered \$\{r\.status\}/.test(HOOK) && /read\.videosWhy \?/.test(ADS) && /ads\.read\.videosWhy \?/.test(MB))
  // TRYBE's answer on Seb's screen (2026-10-24): currencyContext, data,
  // message, pagination, requestId, success, and no video read from it.
  const { readAdVideos, adVideoRows } = require('../lib/trybe-ads') as typeof import('../lib/trybe-ads')
  const { keysOf } = require('../lib/trybe-mybrands') as typeof import('../lib/trybe-mybrands')
  const answer = (data: unknown) => ({ success: true, data, message: 'ok', pagination: { page: 1 }, requestId: 'r', currencyContext: {} })
  check('a list in data is read, with or without an id TRYBE names', readAdVideos(answer([{ submission_id: 's1', metrics: { linkClicks: 2 } }, { metrics: { linkClicks: 1 } }])).length === 2 && readAdVideos(answer([{ submission_id: 's1' }]))[0].id === 's1')
  check('a list one level down in data is found', adVideoRows(answer({ creatives: [{ id: 'a' }] })).length === 1)
  check('what is inside data is described, not only its name', /a list of 2 \(submission_id/.test(keysOf(answer([{ submission_id: 's1' }, {}]))))
  check('an empty list by earnings is asked again by hook rate and said as empty, never "no ads"', /const h = await readVideos\(period, 'hook'\)/.test(HOOK) && /TRYBE sent an empty list of videos for these/.test(HOOK))
  check('My brands says it once, not on every card', /Ads: not read \(see above\)\./.test(MB) && (MB.match(/MVP could not read your ad videos from TRYBE just now/g) || []).length === 1)
}
check('one brand\'s earnings are its period earnings', /earned: oneEarned \?\? one\.totals\.earned/.test(ADS))
check('brands past the lists read still count in All', /for \(const b of unsettled\.slice\(MAX_LISTS\)\)/.test(read('components/labs/useTrybeSubmissions.ts')))
check('Read again reads the ad lines too', /onClick=\{\(\) => \{ ads\.reload\(\); void load\(\) \}\}/.test(MB))

// Paging.
check('changes, tier changes and member rows are paged', /allRows<\{ brand_id: string; kind: string; before: string \| null; after: string \| null; at: string \}>/.test(ROUTE) && /allRows<\{ brand_id: string; before: string \| null; after: string \| null; at: string \}>/.test(ROUTE) && /allRows<Record<string, unknown>>\(\(\) => admin\.from\('trybe_member_stats'\)/.test(ROUTE))

// What changed.
const CH = read('components/labs/TrybeChanges.tsx')
check('yours are the brands you work with, not ones you passed on', /\.\.\.joinedIds,/.test(ROUTE) && /!\['passed', 'not_fit', 'removed', 'skipped'\]\.includes\(r\.status\)/.test(ROUTE))
check('yours are counted as brands everywhere', /new Set\(\(data\?\.changes \|\| \[\]\)\.filter\(\(c\) => c\.yours && onDay\(c\)\)\.map\(\(c\) => c\.brand_id\)\)\.size/.test(CH))
check('a pay cut is amber and tiers are said apart from pay', /export function changeTone/.test(CH) && /payout tier change/.test(CH))
check('only the MVP team clears "left" for everyone', /const healed = tier === 'admin' \? await healJoined/.test(ROUTE) && !/const healed = await healJoined/.test(ROUTE))

// Pay.
check('a flat fee plus a percent on one line is two terms', JSON.stringify(readTerms(['$25 per approved video plus 5% of sales']).terms.map((t) => t.kind)) === '["flat","gmv"]')

if (fails.length) { console.error('trybe-track-cleanup failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-track-cleanup: members\' numbers stay private and honest, unread is never zero, Drop rests on read numbers')
