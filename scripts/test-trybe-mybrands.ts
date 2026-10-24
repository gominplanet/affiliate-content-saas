// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// My brands on TRYBE (Cole on Oink; Seb 2026-10-12, "build 1, 2 and 3"):
//   1. per brand earnings, sent, approved, in review, rejected, approval rate,
//      and the 4 or 5 to focus on and the ones to drop;
//   2. videos stuck in review more than 5 days, with a nudge for the brand;
//   3. the brand's own best videos next to its video ideas, feeding the plan.
// A count MVP could not read is never shown as zero, and SCOUT only reads.

import { readFileSync } from 'node:fs'
import { readDirectoryItem } from '../lib/trybe-directory'
import { readPay } from '../lib/trybe-outreach'
import { join } from 'node:path'
import { readBrandStats, readSubmissions, subStatus, withSubmissions, approvalRate, judgeBrands, stuckOf, nudgeText, readTopVideos, readScript,
  winnersForPlan, winnersBlock, keysOf, STUCK_DAYS, FOCUS_COUNT, type MyBrand } from '../lib/trybe-mybrands'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const NOW = Date.parse('2026-10-12T12:00:00Z')
const day = 86_400_000

// 1. Brand stats, in the shape TRYBE's own page reads (data.brandStats keyed by id).
const stats = {
  success: true,
  data: {
    brandStats: {
      'brand-aaaaaa': { brandName: 'Glow Co', brandLogoUrl: 'https://x/l.png', totalEarnings: 1840.5, totalSubmissions: 30, approvedSubmissions: 24, commissionEnrollments: [{ enrolledAt: '2026-06-01T00:00:00Z', program: { name: 'Main', commissionPercentage: 15 } }] },
      'brand-bbbbbb': { brandName: 'Nope Inc', totalEarnings: 0, totalSubmissions: 12, approvedSubmissions: 1 },
      'brand-cccccc': { brandName: 'Fresh One', totalEarnings: 0, totalSubmissions: 1, approvedSubmissions: 0 },
      'brand-dddddd': { brandName: 'Steady', totalEarnings: '220', totalSubmissions: 6, approvedSubmissions: 5 },
    },
  },
}
const list = readBrandStats(stats)
check('reads every brand from data.brandStats, most earned first', list.length === 4 && list[0].name === 'Glow Co' && list[0].earnings === 1840.5, JSON.stringify(list.map(b => b.name)))
check('the brand id is the key TRYBE uses', list[0].id === 'brand-aaaaaa')
check('earnings as text are read as dollars', list.find(b => b.name === 'Steady')?.earnings === 220)
check('enrolment date and program come from commissionEnrollments', list[0].enrolledAt === '2026-06-01T00:00:00Z' && list[0].programs[0] === 'Main')
check('in review and rejected are null until the submissions are read (never 0)', list.every(b => b.pending === null && b.rejected === null))
check('a list shape works too', readBrandStats({ data: { brandStats: [{ brandId: 'x123456', brandName: 'Listed', totalEarnings: 5 }] } })[0]?.id === 'x123456')
check('an answer MVP cannot read gives no brands, and its keys can be shown to an admin', readBrandStats({ data: { weird: 1 } }).length === 0 && /weird/.test(keysOf({ data: { weird: 1 } })))

// Submission status words.
check('pending, in review, submitted are in review', ['PENDING', 'in_review', 'Under Review', 'submitted', 'PENDING_APPROVAL'].every(s => subStatus(s) === 'pending'))
check('approved, even pending payout, is approved', ['APPROVED', 'approved_pending_payout', 'paid', 'live'].every(s => subStatus(s) === 'approved'))
check('rejected and not approved are rejected', ['REJECTED', 'declined', 'not_approved'].every(s => subStatus(s) === 'rejected'))
check('an unknown or missing status is not called in review', subStatus('') === 'other' && subStatus('draft') === 'other')

// Submissions.
const subsJson = {
  success: true,
  data: [
    { id: 's1aaaaaa', status: 'PENDING', createdAt: new Date(NOW - 9 * day).toISOString(), product: { title: 'Glow Serum' } },
    { id: 's2aaaaaa', status: 'PENDING', createdAt: new Date(NOW - 2 * day).toISOString(), product: { title: 'Glow Serum' } },
    { id: 's3aaaaaa', status: 'REJECTED', createdAt: new Date(NOW - 20 * day).toISOString() },
    { id: 's4aaaaaa', status: 'APPROVED', createdAt: new Date(NOW - 30 * day).toISOString() },
    { id: 's5aaaaaa', status: 'PENDING' },
    { status: 'PENDING', createdAt: new Date(NOW - 9 * day).toISOString() },
  ],
  pagination: { page: 1, totalPages: 1 },
}
const subs = readSubmissions(subsJson)
check('reads submissions with id, status, date and product; skips one without an id', subs.length === 5 && subs[0].product === 'Glow Serum' && subs[0].at != null)
const glow = withSubmissions(list[0], subs)
check('in review and rejected counted from submissions', glow.pending === 3 && glow.rejected === 1)
const stuck = stuckOf(subs, NOW)
check(`only videos in review more than ${STUCK_DAYS} days are stuck, and one with no date never is`, stuck.length === 1 && stuck[0].id === 's1aaaaaa')

// Approval rate and the verdicts.
check('approval is approved out of decided videos when rejected is known', approvalRate({ ...list[1], approved: 1, rejected: 9 }).rate === 0.1)
check('approval without pending or rejected read is said as not exact', approvalRate(list[0]).exact === false)
const judged = judgeBrands([
  ...list.map(b => (b.name === 'Nope Inc' ? { ...b, rejected: 10, pending: 1 } : b)),
  ...Array.from({ length: 6 }, (_, i): MyBrand => ({ id: `extra-${i}aaaa`, name: `Paying ${i}`, logo: null, earnings: 100 + i, submitted: 5, approved: 4, pending: 0, rejected: 1, enrolledAt: null, programs: [] })),
], NOW)
const v = (n: string) => judged.find(j => j.brand.name === n)?.verdict
check(`at most ${FOCUS_COUNT} focus brands, the most paid first`, judged.filter(j => j.verdict === 'focus').length === FOCUS_COUNT && v('Glow Co') === 'focus' && v('Steady') === 'focus')
check('a brand that rejects most videos is dropped, with the numbers in the reason', v('Nope Inc') === 'drop' && /1 of 11/.test(judged.find(j => j.brand.name === 'Nope Inc')!.why))
check('a brand with one video is too early to judge, not dropped', v('Fresh One') === 'early')
check('every verdict says why', judged.every(j => j.why.length > 10))
check('a sixth paying brand is kept, not focused', judged.filter(j => j.brand.name.startsWith('Paying') && j.verdict === 'keep').length >= 2)
check('30 days and 5 videos decided with nothing approved is dropped', judgeBrands([{ id: 'zz123456', name: 'Silent', logo: null, earnings: 0, submitted: 6, approved: 0, pending: 0, rejected: 6, enrolledAt: new Date(NOW - 40 * day).toISOString(), programs: [] }], NOW)[0].verdict === 'drop')
check('5 videos still in review are never a reason to drop', judgeBrands([{ id: 'zz123457', name: 'Waiting', logo: null, earnings: 0, submitted: 6, approved: 0, pending: 6, rejected: 0, enrolledAt: new Date(NOW - 40 * day).toISOString(), programs: [] }], NOW)[0].verdict !== 'drop')
check('a rate from everything sent (rejections not read) never drops a brand', judgeBrands([{ id: 'zz123458', name: 'Unread', logo: null, earnings: 0, submitted: 10, approved: 2, pending: null, rejected: null, enrolledAt: new Date(NOW - 40 * day).toISOString(), programs: [] }], NOW)[0].verdict !== 'drop')

// The nudge.
const nudge = nudgeText('Glow Co', stuck, NOW)
check('the nudge names the brand, the product and how long', /Glow Co/.test(nudge) && /Glow Serum/.test(nudge) && /9 days/.test(nudge))
check('the nudge has no dashes and asks one question', !/[–—]| - /.test(nudge) && (nudge.match(/\?/g) || []).length === 1)

// 3. Copy what wins.
const details = { success: true, data: { name: 'Glow Co', topVideos: [{ id: 'v1aaaaaa', metadata: { thumbnailUrl: 'https://x/1.jpg', previewUrl: 'https://x/1.mp4', title: 'POV: my skin after a week' } }, { id: 'v2aaaaaa', metadata: { thumbnailUrl: 'https://x/2.jpg' } }, { id: 'v3aaaaaa', metadata: {} }] } }
const tops = readTopVideos(details)
check('best videos read from details topVideos (metadata.thumbnailUrl), one with no picture or video skipped', tops.length === 2 && tops[0].thumbnail === 'https://x/1.jpg' && tops[0].video === 'https://x/1.mp4' && tops[0].caption === 'POV: my skin after a week')
check('a top-formats list shape works too', readTopVideos({ data: [{ id: 'f1aaaaaa', thumbnailSrc: 'https://x/f.jpg' }] }).length === 1)
check('a script is read as text, from a string or segments', readScript({ data: { script: 'Hook then body' } }) === 'Hook then body' && readScript({ data: { segments: [{ text: 'one' }, { text: 'two' }] } }) === 'one two' && readScript({ data: {} }) === null)
check('at most three winners go to the plan, short ones dropped', winnersForPlan(['a', 'x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50), 'w'.repeat(50)]).length === 3 && winnersForPlan('nope').length === 0)
check('the plan is told to copy the angle, never the words', /Never copy their sentences/.test(winnersBlock(['x'.repeat(20)])))

// Wiring.
const bg = read('extension/background.js')
const allow = bg.slice(bg.indexOf('const TRYBE_API_ALLOW'), bg.indexOf('\n]\n', bg.indexOf('const TRYBE_API_ALLOW')) + 2)
check('SCOUT reads brand stats, submissions, earnings and scripts', allow.includes('brands\\/stats(') && allow.includes('\\/(submissions|earnings)(') && allow.includes('submissions\\/[A-Za-z0-9-]{6,80}\\/script$/'))
// Up to Send to TRYBE (1.52.0), whose upload calls scripts/test-trybe-submit holds.
check('the new SCOUT entries only read (GET)', allow.slice(allow.indexOf('1.46.0 (My brands)'), allow.indexOf('1.52.0 SEND TO TRYBE')).split('\n').filter(l => /method:/.test(l)).every(l => /method: 'GET'/.test(l)))
const manifest = JSON.parse(read('extension/manifest.json'))
const ver = read('lib/scout-version.ts')
check('SCOUT version matches what MVP asks for', ver.includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`) && /SCOUT_TRYBE_MYBRANDS_MIN_VERSION = '1\.46\.0'/.test(ver))
const page = read('components/labs/TrybeOutreach.tsx')
check('the page has a My brands tab and passes the winners reader to the Sent panel', /\{ id: 'brands', label: 'My brands'/.test(page) && /<TrybeMyBrands/.test(page) && /canReadWinners=\{canMyBrands\}/.test(page))
const mine = read('components/labs/TrybeMyBrands.tsx')
check('a count not read shows as "not read", never 0', /const NA = 'not read'/.test(mine) && /n == null \? NA/.test(mine))
check('a failed read is not retried on its own in a loop', /tried\.current = true/.test(mine))
check('the nudge goes through the shared safe send (seen in the chat, never twice)', /sendInTrybeChat\(chat\.id/.test(mine) && /already in your TRYBE chat, so it was not sent again/.test(mine))
const ideas = read('components/labs/TrybeVideoIdeas.tsx')
check('the video plan gets the winners\' words', /action: 'video_plan', brandId, [^\n]*winners: winnerWords/.test(ideas))
check('no top videos and a failed read are said differently', /TRYBE shows no top videos for this brand yet/.test(ideas) && /could not read this brand's best videos/.test(ideas))
const route = read('app/api/labs/trybe/route.ts')
check('the plan route uses the winners and says when a plan is not kept', /winnersForPlan\(body\.winners\)/.test(route) && /onList: !!own/.test(route))


// The pay filter never empties the list on brands TRYBE gives no pay for
// (Seb, 2026-10-12: "% of sales" hid all 1,000 and the page asked for a keyword).
{
  const withRules = readDirectoryItem({ brandId: 'abc12345', brandName: 'Glow', commissionRules: ['15% of GMV', '$50 per video'] })
  check('TRYBE\'s own pay lines are read when the list carries them', !!withRules && /15% of GMV/.test(withRules.payText || '') && readPay(withRules.payText).kind === 'both')
  check('a commission rate alone is read too', readPay(readDirectoryItem({ brandId: 'abc12346', brandName: 'Rate', commissionRate: '20% commission' })?.payText).kind === 'percent')
  const R = read('app/api/labs/trybe/route.ts')
  check('brands with no pay given stay in the list, after the ones that match', /payPasses\(x\.pay, payType\) \|\| \(payType !== 'any' && !payRead\(x\)\)/.test(R) && /ranked\.sort\(\(a, b\) => (knownFirst\(a, b\) \|\| )?payKnownFirst\(a, b\) \|\|/.test(R))
  const U = read('components/labs/TrybeOutreach.tsx')
  check('the page says what the pay filter did, and an empty list says why', /does not say what .* of these brands pay, so they are listed after the ones that do/.test(U) && /as far as TRYBE&rsquo;s list says/.test(U) && !/Search a keyword or pick a niche to see the brands that match/.test(U))
}

// META ADS AND YOUR VIDEOS AS ADS on each brand (Seb, 2026-10-20: "see if
// they're actually putting ads behind my video").
{
  const MB = read('components/labs/TrybeMyBrands.tsx')
  check('each brand links to its Meta Ad Library, named as such', /href=\{adLibraryUrl\(b\.name\)\}/.test(MB) && />Meta Ad Library <ExternalLink/.test(MB))
  check('each brand says from TRYBE whether your videos run as ads, and what was spent', /<AdsLine b=\{b\} ads=\{ads\.read\}/.test(MB) && /const \{ totals, videos \} = brandAdTotals\(ads\.videos, b\)/.test(MB) && /videos\.filter\(\(v\) => v\.live === true\)/.test(MB) && /useTrybeAds\(canRead && readAt != null, '30d'\)/.test(MB))
  check('a read it could not do says so, never "none"', /TRYBE’s ad numbers were not read\./.test(MB) && /cannot say whether your videos run as ads/.test(MB))
}

if (failed) { console.error(`\n${failed} My brands check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
