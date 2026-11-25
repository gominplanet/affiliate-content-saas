// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE's own score, in its three parts, in the MVP pick.
//
// Seb, 2026-11-25, with arrae's TRYBE Score open (46 overall; Submission
// reviews 16, slow; Launching ads 91, fast; Chat responsiveness 16, slow):
// "These do all have to be taken into consideration when MVP gives their
// recommendation. So right now, if I click on MVP pick, I see this brand Array
// has a 91 MVP pick. And I'm not sure that's right."

import { readFileSync, existsSync } from 'node:fs'
import { readScoreParts, readSavedParts, partOf, partWord, PART_LABEL, readPageFacts, withPageFacts } from '../lib/trybe-score'
import { pickScore, weighScore, DEFAULT_PRIORITIES, FACTORS, type PickInput } from '../lib/trybe-pick'
import { scorecard, readLiveBrand } from '../lib/trybe-dossier'
import { ratingOf } from '../lib/trybe-finder'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const ARRAE = { reviews: 16, ads: 91, chat: 16 }

// 1. Read from the brand details, whatever TRYBE calls the fields
check('a score object with named parts', same(readScoreParts({ data: { trybeScore: { overall: 46, submissionReviews: 16, launchingAds: 91, chatResponsiveness: 16 } } }), ARRAE))
check('a list of labelled scores', same(readScoreParts({ brand: { score: { total: 46, breakdown: [{ label: 'Submission reviews', value: 16 }, { label: 'Launching ads', value: 91 }, { label: 'Chat responsiveness', value: 16 }] } } }), ARRAE))
check('flat keys that say they are scores', same(readScoreParts({ submission_review_score: 16, launching_ads_score: 91, chat_responsiveness_score: 16 }), ARRAE))
check('labelled scores in any list, with the value under score', same(readScoreParts({ metrics: [{ name: 'Submission Reviews', score: '16' }, { name: 'Launching Ads', score: '91' }, { name: 'Chat Responsiveness', score: '16' }] }), ARRAE))
check('one part found, the others stay unknown', same(readScoreParts({ scores: { chatResponsiveness: 72 } }), { reviews: null, ads: null, chat: 72 }))
check('a star rating is never read as a review speed', readScoreParts({ reviewScore: 3.5 }) === null && readScoreParts({ rating: 4.5, reviewCount: 40, averageRating: 4.4 }) === null)
check('counts and totals are not parts', partOf('reviewCount') === null && partOf('totalReviews') === null && partOf('adsCount') === null)
check('a number that cannot be TRYBE’s is left out', readScoreParts({ score: { submissionReviews: 160 } }) === null)
check('a page with no score says nothing, never a guess', readScoreParts({ name: 'arrae', totalCreators: 1200 }) === null && readScoreParts(null) === null && readScoreParts('x') === null)
check('saved parts are read back safely', same(readSavedParts(ARRAE), ARRAE) && readSavedParts({ reviews: 'x' }) === null && readSavedParts(null) === null)
check('fast, okay and slow, as TRYBE words them', partWord(91) === 'Fast' && partWord(70) === 'Fast' && partWord(46) === 'Okay' && partWord(16) === 'Slow')
check('each part has its own words, no dashes', Object.values(PART_LABEL).every((w) => w && !/[–—]/.test(w)))

// 2. The pick weighs them
const base: PickInput = { totalCreators: 40, metaAds: 60, top100Hits: 3, tiktokShop: false, earningsBucket: '$10K - $50K', commissionPct: 15, perVideo: 60, perVideoBasis: 'terms', samples: true }
const plain = pickScore(base)
const arrae = pickScore({ ...base, trybeScore: { overall: 46, ...ARRAE }, rating: 3.5, ratingCount: 24 })
check('arrae-like: slow reviews and chats, 3.5 stars, pull the pick down a lot', plain.score - arrae.score >= 30)
check('and say why, in words', arrae.reasons.some((r) => r.tone === 'bad' && /Slow to review videos \(TRYBE: 16 of 100\)/.test(r.text)) && arrae.reasons.some((r) => r.tone === 'bad' && /Slow to answer messages/.test(r.text)) && arrae.reasons.some((r) => r.tone === 'good' && /Launches videos as ads fast/.test(r.text)) && arrae.reasons.some((r) => r.tone === 'bad' && /Creators rate it 3\.5/.test(r.text)))
check('a slow review queue costs more than fast ads earn back', (arrae.parts.easyToWork ?? 0) < 0)
const quick = pickScore({ ...base, trybeScore: { overall: 88, reviews: 90, ads: 85, chat: 80 }, rating: 4.8, ratingCount: 30 })
check('a brand TRYBE scores fast in all three, and creators rate well, goes up', quick.score > plain.score && quick.reasons.some((r) => /Reviews videos fast/.test(r.text)))
const overallOnly = pickScore({ ...base, trybeScore: { overall: 46, reviews: null, ads: null, chat: null } })
check('before the parts are read, a low overall TRYBE score still counts', overallOnly.score < plain.score && overallOnly.reasons.some((r) => /TRYBE score 46 of 100/.test(r.text)))
check('a rating from a handful of reviews is not weighed', pickScore({ ...base, rating: 2.5, ratingCount: 3 }).score === plain.score)
check('nothing read, nothing changes', pickScore({ ...base, trybeScore: null, rating: null }).score === plain.score)
check('Easy to work with is a priority the creator can set, normal by default', FACTORS.some((f) => f.id === 'easyToWork' && f.label === 'Easy to work with' && !/[–—]/.test(f.says)) && DEFAULT_PRIORITIES.easyToWork === 1)
check('"Skip" leaves it out, "A lot" counts it twice', weighScore(arrae, { ...DEFAULT_PRIORITIES, easyToWork: 0 }) === arrae.score - (arrae.parts.easyToWork ?? 0) && weighScore(arrae, { ...DEFAULT_PRIORITIES, easyToWork: 2 }) === arrae.score + (arrae.parts.easyToWork ?? 0))
check('no dashes in what the pick says', [...arrae.reasons, ...quick.reasons, ...overallOnly.reasons].every((r) => !/[–—]/.test(r.text)))

// 3. The brand page: Decides fast uses its review part before MVP creators timed it
{
  const dims = scorecard({
    pay: { dollars: null, short: null, basis: null }, meta: { count: null, own: false, fresh: false, top100Hits: null },
    samples: { trybe: null, products: null, pool: null }, pool: null,
    trybe: { creators: null, rating: null, reviews: null, score: 46, approvedVideos: null, parts: ARRAE },
  } as Parameters<typeof scorecard>[0])
  const speed = dims.find((d) => d.id === 'speed')
  check('Decides fast is slow, from its review part, not the overall 46', speed?.score === 16 && speed.grade === 'weak' && /Slow to review, 16 of 100/.test(speed.value) && /submission reviews/.test(speed.source))
}

// 4. Wired in
const ROUTE = read('app/api/labs/trybe/route.ts')
check('Find brands reads the kept parts and gives them to the pick', /const SCORE_COLS = ', trybe_score_parts, trybe_score_at'/.test(ROUTE) && /trybeScore: \{ overall: typeof r\.trybe_score === 'number'/.test(ROUTE) && /readSavedParts\(r\.trybe_score_parts\)/.test(ROUTE) && /rating: ratingOf\(r\)\?\.stars/.test(ROUTE))
check('a database without migration 473 still lists brands', /BASE_COLS \+ PICK_COLS \+ POP_COLS \+ OWN_COLS \+ SCORE_COLS, BASE_COLS \+ PICK_COLS \+ POP_COLS \+ OWN_COLS,/.test(ROUTE))
check('live_facts keeps the parts, and the rest when the columns are missing', /const parts = readSavedParts\(body\.parts\)/.test(ROUTE) && /trybe_score_parts: parts/.test(ROUTE) && /\/trybe_score_\(parts\|at\)\/\.test\(lfErr\.message\)/.test(ROUTE))
check('the parts reach the brand page', /trybe_parts: readSavedParts\(r\.trybe_score_parts\)/.test(ROUTE))
const KEEP = read('lib/trybe-score-keep.ts')
check('one helper sends what a page showed, once per brand, with a deadline', /action: 'live_facts', brandId, \.\.\.facts/.test(KEEP) && /AbortSignal\.timeout\(/.test(KEEP) && /kept\.has\(brandId\)/.test(KEEP))
for (const [f, re] of [
  ['components/labs/TrybeDossier.tsx', /keepTrybeFacts\(brandId, r\.json\)/],
  ['components/labs/TrybeBrandCard.tsx', /keepTrybeFacts\(id, r\.json\)/],
  ['components/labs/TrybeBrandScripts.tsx', /keepTrybeFacts\(b\.id, d\.json\)/],
  ['components/labs/DropTrybePicker.tsx', /keepTrybeFacts\(value\.brandId, d\.json\)/],
] as Array<[string, RegExp]>) check(`${f} keeps the score it read`, re.test(read(f)))
check('no new read of TRYBE is made for it', !/requestTrybeApi/.test(KEEP))
const D = read('components/labs/TrybeDossier.tsx')
check('the brand page shows the three parts, worded and coloured', /aria-label="TRYBE score, in its three parts"/.test(D) && /PART_LABEL\[k\]/.test(D) && /parts: live\?\.parts \?\? readSavedParts\(listing\?\.trybe_parts\)/.test(D))
const MIG = 'supabase/migrations/473_trybe_score_parts.sql'
check('migration 473 adds both columns, safe to run twice', existsSync(MIG) && /add column if not exists trybe_score_parts jsonb/.test(read(MIG)) && /add column if not exists trybe_score_at timestamptz/.test(read(MIG)))

// 5. What its own page says wins over MVP's copy of the list (Seb, 2026-11-25,
//    Chef Preserve: 4.9 from 146 reviews and $500K+ earned on its page; 22
//    reviews and paid out $50K+ in MVP's lists; "earned $500K+ earned").
{
  const live = readLiveBrand({ data: { reviewRating: 4.9, reviewCount: 146, creatorEarnings: '$500K+ earned' } })
  check('its earnings read once, without TRYBE\'s own "earned"', live.numbers.find((n) => n.id === 'earnings')?.value === '$500K+')
  check('how many rated it is kept as a number', live.ratingCount === 146)
  check('page facts are read safely', same(readPageFacts({ rating: 4.9, reviews: 146, earnings: '$500K+ earned' }), { rating: 4.9, reviews: 146, earnings: '$500K+' }) && readPageFacts({ rating: 9, reviews: -1, earnings: 'lots' }) === null && readPageFacts(null) === null)
  const row = { brand_id: 'cp', rating: 4.9, earnings_bucket: '$50K+', raw: { reviewCount: 22, reviewRating: 4.9, other: 1 }, trybe_page: { rating: 4.9, reviews: 146, earnings: '$500K+' } }
  const laid = withPageFacts(row)
  check('the list shows 146 reviews and $500K+, the rest of its entry kept', ratingOf(laid)?.reviews === 146 && laid.earnings_bucket === '$500K+' && (laid.raw as Record<string, unknown>).other === 1)
  check('earnings all time never fall: a lower page figure leaves the list\'s', withPageFacts({ ...row, earnings_bucket: '$1M+', trybe_page: { earnings: '$500K+' } }).earnings_bucket === '$1M+')
  const unread = { ...row, trybe_page: null }
  check('a brand its page was never read for is left as it is', withPageFacts(unread) === unread && unread.earnings_bucket === '$50K+')
}
{
  const R2 = read('app/api/labs/trybe/route.ts')
  check('Find brands lays the page over each row before anything is weighed', /rows = rows\.map\(withPageFacts\)/.test(R2) && R2.indexOf('rows = rows.map(withPageFacts)') < R2.indexOf('const amazonBy = new Map(rows.map'))
  check('and still lists brands before migration 474', /\+ SCORE_COLS \+ PAGE_COLS, BASE_COLS \+ PICK_COLS \+ POP_COLS \+ OWN_COLS \+ SCORE_COLS,/.test(R2))
  check('live_facts keeps the page facts in their own column, and the rest without it', /readPageFacts\(\{ rating: body\.rating, reviews: body\.reviews, earnings: body\.earnings \}\)/.test(R2) && /withParts\.trybe_page = /.test(R2) && /\/trybe_page\/\.test\(lfErr\.message\)/.test(R2))
  check('the page sends its rating, review count and earnings', /rating: n\('rating'\), reviews: read\.ratingCount/.test(read('lib/trybe-score-keep.ts')))
  check('the brand page counts the reviews its page shows first', /reviews: live\?\.read\?\.ratingCount \?\? /.test(read('components/labs/TrybeDossier.tsx')))
  const T = read('components/labs/TrybeBrandTable.tsx')
  check('the results table says TRYBE\'s parts where members have no results yet', /const tp = readSavedParts\(b\.trybe_parts\)/.test(T) && /Reviews <Dot/.test(T) && /Chats <Dot/.test(T) && /\[\.\.\.members, \.\.\.trybeSays\]/.test(T))
  const M4 = 'supabase/migrations/474_trybe_page_facts.sql'
  check('migration 474 adds the column, safe to run twice', existsSync(M4) && /add column if not exists trybe_page jsonb/.test(read(M4)))
}

if (failures.length) {
  console.error(`test-trybe-score: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-score: all checks passed')
