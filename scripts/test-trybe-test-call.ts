// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The brand page says TRYBE's own numbers the way TRYBE does, why a brand was
// judged not a fit, and when a brand is worth a test of 5 to 10 videos (Seb,
// 2026-11-20, on The Perfect Jean: on TRYBE 36 days, $30K+ earned, 400
// creators, TRYBE score 85, 4.8 from 17 reviews, 10% of GMV capped at $5,000
// a submission, and "MVP judged it not a fit").

import { readFileSync } from 'node:fs'
import { testCall, testCallOf, NEW_DAYS, TEST_MIN_PAID, ROOM_CREATORS, type TestCallInput } from '../lib/trybe-test-call'
import { readLiveBrand } from '../lib/trybe-dossier'
import { estimatePay } from '../lib/trybe-pay'
import { paidOutOf } from '../lib/trybe-daily'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. Worth a test
const jean: TestCallInput = { daysOnTrybe: 36, paidOut: paidOutOf({ earnings_bucket: '$30K+' }), earnedWords: '$30K+', creators: 400, rating: 4.8, reviews: 17, score: 85, maxPer: 5000, notFit: true }
const t = testCall(jean)
check('The Perfect Jean is worth a test', !!t && t.title === 'Worth a test: 5 to 10 videos')
check('each reason in its own numbers', !!t && t.why[0] === 'On TRYBE 36 days, and its creators have already earned $30K+.' && t.why.includes('400 creators work with it, so each one gets more of its budget.') && t.why.includes('4.8 ★ from 17 creators who worked with it.') && t.why.some((w) => /^TRYBE score 85/.test(w)))
check('the plan is a small test', !!t && /film 5 to 10 videos of one product/.test(t.plan))
check('not a fit and the cap are said, not hidden', !!t && t.caveats.some((c) => /said not a fit\. Five to ten videos tell you more than that read/.test(c)) && t.caveats.some((c) => /caps what one video can earn at \$5K\. That only matters if a video wins big/.test(c)))
check('a brand that has paid out little is not called worth a test', testCall({ ...jean, paidOut: 2000, earnedWords: '$2K+' }) === null)
check('an old crowded brand with nothing special is not either', testCall({ ...jean, daysOnTrybe: 400, creators: 3000, rating: 4.1, score: 60 }) === null)
check('an old brand with room, pay and good reviews is', !!testCall({ ...jean, daysOnTrybe: 400, notFit: false, maxPer: null }) && testCall({ ...jean, daysOnTrybe: 400, notFit: false, maxPer: null })!.caveats.length === 0)
check('a brand with nothing known is not', testCall({ daysOnTrybe: null, paidOut: null, earnedWords: null, creators: null, rating: null, reviews: null, score: null, maxPer: null, notFit: false }) === null)
check('the lines: 90 days new, $10K paid, under 500 creators', NEW_DAYS === 90 && TEST_MIN_PAID === 10_000 && ROOM_CREATORS === 500)
check('no dashes in what it says', !/[–—]/.test(JSON.stringify(t)))

// 1b. The same call from a brand's card in the list (Seb: "show on brand cards too")
const now = Date.parse('2026-11-20T12:00:00Z')
const row = { total_creators: 400, earnings_bucket: '$30K+', stats: { paidOut: null, joinedAt: '2026-10-15T12:00:00Z' }, review_rating: 4.8, review_count: 17, trybe_score: 85, pay_est: { maxPer: 5000 }, status: 'not_fit' }
const rc = testCallOf(row, now)
check('a card reads the same call from the list row', !!rc && rc.why[0] === 'On TRYBE 36 days, and its creators have already earned $30K+.' && rc.caveats.length === 2)
check('TRYBE\u2019s paid out total wins over the range', !!testCallOf({ ...row, earnings_bucket: '$1K+', stats: { paidOut: 25_000, joinedAt: '2026-10-15T12:00:00Z' } }, now))
check('a card with no payout known gets no chip', testCallOf({ total_creators: 100, review_rating: 5, review_count: 40, trybe_score: 95 }, now) === null)

// 2. TRYBE's own numbers, wherever its page keeps them
const deep = readLiveBrand({ data: { brand: { name: 'The Perfect Jean', createdAt: '2026-10-15T12:00:00Z', metrics: { stats: { totalCreators: 400, trybeScore: { value: 85 }, creatorEarnings: '$30K+' } } } } })
const by = Object.fromEntries(deep.numbers.map((n) => [n.id, n.value]))
check('creators, score and earnings are found three levels down', by.creators === '400' && by.score === '85' && by.earnings === '$30K+')
check('when it joined TRYBE is read', deep.createdAt === '2026-10-15T12:00:00.000Z')
check('a review’s own score deep down is never taken for the TRYBE score', !readLiveBrand({ data: { reviews: { latest: { score: 4 } } } }).numbers.some((n) => n.id === 'score'))
check('a join date in the future is not one', readLiveBrand({ createdAt: '2999-01-01T00:00:00Z' }).createdAt === null)
check('the cap comes from its own page’s pay line', estimatePay({ lines: ['10% of GMV (max $5000.00 per submission, Videos only)'] }).maxPer === 5000)

// 3. Wired in
const D = read('components/labs/TrybeDossier.tsx')
check('the page shows TRYBE’s five numbers, from its page first', /aria-label="TRYBE's own numbers"/.test(D) && /label: 'Total creators'/.test(D) && /label: 'TRYBE score'/.test(D) && /label: 'Creator earnings'/.test(D) && /label: 'On TRYBE'/.test(D))
check('a number it could not read says why, never a blank', /SCOUT could not read its page on TRYBE \(\$\{live\.error\}\)/.test(D) && /'Not read'/.test(D))
check('not a fit says the fit check’s reason', /status === 'not_fit' && \(/.test(D) && /Why: \{d\.you\.fitReason/.test(D) && /The fit check gave no reason\./.test(D))
check('the worth a test card sits before MVP’s read', D.indexOf('{test && (') > 0 && D.indexOf('{test && (') < D.indexOf('── VERDICT'))
check('the cap from its own page reaches the pay box', /maxPer: listing\?\.pay_est\?\.maxPer \?\? livePay\?\.maxPer \?\? null, earned/.test(D))
check('the numbers read are kept for the lists', /void post\(\{ action: 'live_facts', brandId, creators: n\('creators'\), score: n\('score'\) \}\)/.test(D))
check('the cards and the table in Find brands show it, with the reasons on hover', /const tc = testCallOf\(b\); return tc \? <TestChip call=\{tc\} \/> : null/.test(read('components/labs/TrybeOutreach.tsx')) && /const tc = testCallOf\(b\); return tc \? <span className="block mt-0\.5"><TestChip call=\{tc\} \/><\/span> : null/.test(read('components/labs/TrybeBrandTable.tsx')) && /title=\{`Worth a test of 5 to 10 videos\. \$\{\[\.\.\.call\.why, \.\.\.call\.caveats\]\.join\(' '\)\}`\}/.test(read('components/labs/trybe-ui.tsx')))
check('the card and the brand page share one colour, apart from the gold and the blue', /export const TEST = \{ color: '#059669'/.test(read('components/labs/trybe-ui.tsx')) && /background: TEST\.soft, border: `1px solid \$\{TEST\.line\}`/.test(D))
const R = read('app/api/labs/trybe/route.ts')
check('the server keeps only numbers that can be TRYBE’s', /if \(action === 'live_facts'\) \{/.test(R) && /const score = int\(body\.score, 100\)/.test(R) && /from\('trybe_directory'\)\.update\(patch\)\.eq\('brand_id', brandId\)/.test(R))
check('TRYBE Free does not write the shared copy', !/'live_facts'/.test(read('lib/trybe-free.ts')))

if (failures.length) {
  console.error(`test-trybe-test-call: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-test-call: all checks passed')
