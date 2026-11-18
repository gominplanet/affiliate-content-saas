// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A cap on what one video earns, flagged (Seb, 2026-11-18: "a brand that
// maxes out their commission per submission is not a good brand"), and the
// brand page's boxes filled from what TRYBE shows instead of "not enough yet",
// "not known" and "depends on sales" (the same day).

import { readFileSync } from 'node:fs'
import { readTerm, estimatePay } from '../lib/trybe-pay'
import { pickScore } from '../lib/trybe-pick'
import { scorecard, type ScoreInput } from '../lib/trybe-dossier'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. The cap per video, read from TRYBE's words (1stHour, 2026-11-18)
const line = '10% of sales (max $5000.00 per submission, Videos only)'
const t = readTerm(line)
check('the pay line is a % of sales with its cap', t?.kind === 'gmv' && t.amount === 10 && t.cap === 5000)
const capped = estimatePay({ lines: [line] })
check('the estimate says the percent and the cap per video', capped.percent === 10 && capped.maxPer === 5000 && capped.dollars === null)
const free = estimatePay({ lines: ['15% of GMV'] })
check('no cap reads as none', free.percent === 15 && free.maxPer === null)
check('a flat fee "up to" is not a cap on sales', estimatePay({ lines: ['up to $100 per video'] }).maxPer === null)
check('the lowest cap of several counts', estimatePay({ lines: ['10% of sales (max $5000 per submission)', '5% of ad spend, max $800'] }).maxPer === 800)
check('a cap on orders counts too', estimatePay({ lines: ['$5 per order, max $300'] }).maxPer === 300)

// 2. The pick counts it against the brand
const base = { totalCreators: 200, metaAds: null, top100Hits: null, tiktokShop: null, commissionPct: 10 }
const withCap = pickScore({ ...base, payCapPer: 5000 })
const without = pickScore(base)
check('a capped brand scores lower', withCap.score < without.score)
check('the cap is a bad reason, in words', withCap.reasons.some((r) => r.tone === 'bad' && /Caps what one video can earn at \$5K: a video that sells well earns no more/.test(r.text)))

// 3. The brand page boxes
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  pay: { dollars: null, short: 'Depends on sales', basis: 'variable', percent: null, maxPer: null, earned: null },
  meta: { count: null, own: false, fresh: false, top100Hits: null },
  samples: { trybe: null, products: null, pool: null },
  pool: null, crowd: null, replies: null, trybe: null, ...over,
})
const dim = (dims: ReturnType<typeof scorecard>, id: string) => dims.find((x) => x.id === id)!
const pct = dim(scorecard(input({ pay: { dollars: null, short: 'Depends on sales', basis: 'variable', percent: 10, maxPer: null, earned: '$10K+' } })), 'pay')
check('pay on sales says its percent, not "depends on sales"', pct.value === '10% of sales' && pct.score === 65 && /Its creators have earned \$10K\+/.test(pct.source))
check('15% of sales is strong', dim(scorecard(input({ pay: { dollars: null, short: null, basis: null, percent: 15 } })), 'pay').grade === 'strong')
const cap = dim(scorecard(input({ pay: { dollars: null, short: null, basis: null, percent: 10, maxPer: 5000 } })), 'pay')
check('a cap per video is said and held down', cap.value === '10% of sales, max $5K' && (cap.score ?? 100) <= 25 && cap.grade === 'weak' && /Capped: one video earns no more than \$5K/.test(cap.source))
check('a dollar figure with a cap is held down too', (dim(scorecard(input({ pay: { dollars: 80, short: null, basis: 'terms', maxPer: 500 } })), 'pay').score ?? 100) <= 25)
const facts = { creators: 200, rating: 4.8, reviews: 6, score: 91, approvedVideos: 340 }
const dims = scorecard(input({ trybe: facts }))
check('approvals before MVP results: creators’ stars on TRYBE', dim(dims, 'approval').value === '4.8 ★ from creators' && dim(dims, 'approval').score === 80 && /6 creator reviews on TRYBE, 340 videos approved/.test(dim(dims, 'approval').source))
check('a rating from one or two reviews is not called strong', (dim(scorecard(input({ trybe: { ...facts, reviews: 1 } })), 'approval').score ?? 100) <= 60)
check('approved videos alone still say something', dim(scorecard(input({ trybe: { ...facts, rating: null, reviews: null } })), 'approval').value === '340 approved')
check('speed before MVP results: TRYBE’s own score', dim(dims, 'speed').value === 'TRYBE score 91' && dim(dims, 'speed').score === 91)
check('room before recent videos: its creators on TRYBE', dim(dims, 'room').value === '200 creators' && dim(dims, 'room').score === 60)
check('MVP creators’ own results still come first', dim(scorecard(input({ trybe: facts, pool: { approvalRate: 0.7, reviewDays: 4, slowShare: null } })), 'approval').value === '70% approved')
const bare = scorecard(input())
check('nothing to go on is not scored, and never says not enough yet or not known', ['approval', 'speed', 'room'].every((id) => dim(bare, id).score === null) && !bare.some((x) => /Not enough yet|^Not known$/.test(x.value)))

// 4. Wiring
const D = read('components/labs/TrybeDossier.tsx')
check('the brand page gives the scorecard what TRYBE shows', /trybe: trybeFacts,/.test(D) && /liveNum\('creators'\) \?\? \(typeof listing\?\.total_creators === 'number'/.test(D) && /percent: listing\?\.pay_est\?\.percent \?\? null, maxPer: listing\?\.pay_est\?\.maxPer \?\? null/.test(D))
check('only a known box is drawn; the rest are named in one line', /dims\.filter\(\(x\) => x\.score != null\)\.map/.test(D) && /Not scored yet:/.test(D))
check('MVP creators’ results wait as one line until there are some', /What MVP creators got back from it shows here once 5 of them have results/.test(D))
check('the list carries the percent and the cap', /percent: e\.percent, maxPer: e\.maxPer/.test(read('app/api/labs/trybe/route.ts')) && /payCapPer: estBy\.get\(r\.brand_id\)\?\.maxPer \?\? null/.test(read('app/api/labs/trybe/route.ts')))
check('the cap is flagged in red in the pay chip and the table', /est\.maxPer != null && <MaxPerChip/.test(read('components/labs/TrybeFinderControls.tsx')) && /b\.pay_est\?\.maxPer != null && <MaxPerChip/.test(read('components/labs/TrybeBrandTable.tsx')))

if (failures.length) {
  console.error(`test-trybe-brand-facts: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-brand-facts: all checks passed')
