// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A VIDEO PAYS, HOW CROWDED, NEW, STATICS (Seb, 2026-10-14, after Rob's
// Oink Suite video: "build all 4"). The figure per approved video comes from
// real results first and never turns a % of sales into a made-up dollar
// amount; OPEN, FILLING or CROWDED says why; NEW does not call every brand
// new the week MVP started collecting.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ruleText, payLines, readTerm, estimatePay, payReadOf } from '../lib/trybe-pay'
import { readDirectoryItem } from '../lib/trybe-directory'
import { payPasses } from '../lib/trybe-outreach'
import { crowdOf, mergeSnapshot, pickBaseline, isNewBrand, readFilters, filterCheck, readDirStats } from '../lib/trybe-finder'
import { pickScore, staticsOf, readPriorities, DEFAULT_PRIORITIES, weighScore } from '../lib/trybe-pick'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── TRYBE's own pay lines ──
check('a rule is displayValue + displayLabel, as TRYBE\'s page shows it', ruleText({ displayValue: '15%', displayLabel: 'of GMV' }) === '15% of GMV' && ruleText({ displayText: '$40 per approved video' }) === '$40 per approved video' && ruleText({ text: 'old shape' }) === 'old shape')
const dir = readDirectoryItem({ brandId: 'abc12345', brandName: 'Glow', commissionRules: [{ displayValue: '$50', displayLabel: 'per submission' }, { displayValue: '10%', displayLabel: 'of GMV' }] })
check('the directory now keeps those rules as its pay line (it read none before)', !!dir && dir.payText === '$50 per submission · 10% of GMV', dir?.payText || '')
const lines = payLines({ commissionRules: [{ displayValue: '12%', displayLabel: 'of ad spend' }], programs: [{ commissionRules: [{ displayText: 'Guaranteed $600 this period if you submit 12 videos' }] }] }, '12% of ad spend')
check('pay lines come from the entry, its programs, and the kept line, once each', lines.length === 2 && lines[0] === '12% of ad spend' && /Guaranteed \$600/.test(lines[1]), JSON.stringify(lines))

// ── Every way TRYBE pays ──
const t = (s: string) => readTerm(s)
check('% of GMV, % of ad spend, per order, flat, bonus and retainer are each read', t('15% of GMV')?.kind === 'gmv' && t('10% of ad spend')?.kind === 'adSpend' && t('$3 per order')?.kind === 'perOrder'
  && t('$50 per video')?.kind === 'flat' && t('$100 bonus at 20 videos')?.kind === 'bonus' && t('Guaranteed $500 if you submit 10 videos')?.kind === 'retainer' && t('Guaranteed $500 if you submit 10 videos')?.videos === 10)
check('a cap is read and never taken as the amount', t('20% of GMV, up to $150 per video')?.cap === 150 && t('20% of GMV, up to $150 per video')?.amount === 20 && t('$80 per video, capped at $60')?.amount === 80 && t('$80 per video, capped at $60')?.cap === 60)
check('"up to 10 videos" is not a cap, and a line with no number is not a term', t('$40 per video, up to 10 videos')?.cap === null && t('Paid every 14 days') === null)

// ── One figure per approved video ──
const flat = estimatePay({ lines: ['$50 per video', '10% of GMV'] })
check('a flat fee is the figure; the % of sales is said on top, never as dollars', flat.dollars === 50 && flat.basis === 'terms' && flat.guaranteed && flat.plus.some(p => /10% of the sales/.test(p)) && /\+$/.test(flat.short))
const ret = estimatePay({ lines: ['Guaranteed $600 this period if you submit 12 videos'] })
check('a retainer is spread over the videos it asks for', ret.dollars === 50 && ret.math.some(m => /\$600 guaranteed for 12 videos: \$50 a video/.test(m)))
const capped = estimatePay({ lines: ['$80 per video, capped at $60'] })
check('a cap holds the figure down and says so', capped.dollars === 60 && capped.capped)
const pctOnly = estimatePay({ lines: ['15% of GMV'] })
check('% of sales only reads "depends on sales", never $0', pctOnly.dollars === null && pctOnly.basis === 'variable' && pctOnly.short === 'Depends on sales')
const ads = estimatePay({ lines: ['8% of ad spend'] })
check('% of ad spend only reads "depends on ad spend"', ads.dollars === null && ads.short === 'Depends on ad spend')
const members = estimatePay({ lines: ['15% of GMV'], members: 37.5 })
check('members\' pooled results give a figure where the terms cannot', members.dollars === 37.5 && members.basis === 'members' && /members/.test(members.short))
const yours = estimatePay({ lines: ['$20 per video'], yours: { earnings: 900, approved: 12 }, members: 30 })
check('your own results with the brand come first', yours.dollars === 75 && yours.basis === 'yours' && /yours/.test(yours.short))
const unclear = estimatePay({ lines: ['Commission program'] })
check('terms MVP cannot read say so, and no pay at all says that', unclear.dollars === null && unclear.short === 'Pay terms unclear' && estimatePay({ lines: [] }).short === 'Pay not listed')

// ── The pay filter ──
const pr = payReadOf(['Guaranteed $500 if you submit 10 videos', '10% of ad spend'])
check('the pay filter reads ad spend and guaranteed pay term by term', payPasses(pr, 'adspend') && payPasses(pr, 'guaranteed') && !payPasses(payReadOf(['$50 per video']), 'guaranteed') && pr.dollars === 50)
check('a retainer\'s whole amount never passes as a fee per video', payReadOf(['Guaranteed $500 if you submit 10 videos']).dollars === 50)

// ── OPEN, FILLING, CROWDED ──
check('few creators and little going on is OPEN', crowdOf({ creators: 8, then: [6, 20], videosNow: 35, days: 30 }).level === 'open')
const filling = crowdOf({ creators: 25, then: [10, 100], videosNow: 150, days: 30 })
check('creators joining fast is FILLING, with why', filling.level === 'filling' && /15 joined in 30 days/.test(filling.why), filling.why)
check('many creators, or many videos a month, is CROWDED', crowdOf({ creators: 400 }).level === 'crowded' && crowdOf({ creators: 60, recent30: 900 }).level === 'crowded')
check('a short window is scaled to a month, not read as a quiet one', crowdOf({ creators: 20, then: [15, null], days: 10 }).level === 'filling')
check('no creator count is not judged', crowdOf({ creators: null }).level === null)
check('30 day videos come from TRYBE\'s entry when it sends them', readDirStats({ brandId: 'abc12345', videosLast30Days: 44 }).videos30d === 44)
const snap = mergeSnapshot({ a: [1, 2] }, [{ brand_id: 'a', total_creators: 9, raw: {} }, { brand_id: 'b', total_creators: 3, raw: { approvedVideos: 7 } }], false)
check('a member\'s collection fills the day\'s snapshot, never rewrites it', snap.a[0] === 1 && snap.b[0] === 3 && snap.b[1] === 7 && mergeSnapshot({ a: [1, 2] }, [{ brand_id: 'a', total_creators: 9, raw: {} }], true).a[0] === 9)
check('the baseline is the snapshot nearest a month back, and never under a week', pickBaseline(['snap:2026-09-13', 'snap:2026-09-20', 'snap:2026-10-10'], '2026-10-14')?.key === 'snap:2026-09-13' && pickBaseline(['snap:2026-10-10'], '2026-10-14') === null)
check('Open only hides crowded brands and lists unknown ones after', filterCheck({ perVideo: null, creators: 5, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false, crowd: 'crowded' }, readFilters({ openOnly: true })).pass === false
  && filterCheck({ perVideo: null, creators: null, stats: readDirStats({}), earningsBucket: null, amazon: null, starred: false, crowd: null }, readFilters({ openOnly: true })).unknown.includes('openOnly'))

// ── NEW ──
const now = Date.parse('2026-10-14T12:00:00Z')
check('a brand TRYBE says joined this month is NEW', isNewBrand({ joinedAt: '2026-10-01T00:00:00Z', firstSeen: null, firstEver: null, now }))
check('every brand is not NEW the week MVP started collecting', !isNewBrand({ joinedAt: null, firstSeen: '2026-10-06T10:00:00Z', firstEver: '2026-10-06T09:00:00Z', now })
  && isNewBrand({ joinedAt: null, firstSeen: '2026-10-12T10:00:00Z', firstEver: '2026-10-06T09:00:00Z', now }))

// ── Statics ──
check('statics are read from format fields or the brand\'s own words, never said "no"', staticsOf({ contentTypes: ['VIDEO', 'STATIC'] }, null) === true && staticsOf({}, 'We want UGC photos and videos') === true && staticsOf({}, 'Video creators only') === null && staticsOf({}, 'no static electricity here') === null)
const pri = readPriorities({})
check('statics do not count until you say you make them', pri.statics === 0 && DEFAULT_PRIORITIES.statics === 0)
const p = pickScore({ totalCreators: 10, metaAds: null, top100Hits: null, tiktokShop: null, statics: true })
check('What you make weighs statics', weighScore(p, { ...pri, statics: 2 }) - weighScore(p, pri) === 20)
const q = pickScore({ totalCreators: 10, metaAds: null, top100Hits: null, tiktokShop: null, perVideo: 37.5, perVideoBasis: 'members', guaranteed: true })
check('Best bets says where the figure comes from, and guaranteed pay counts', q.reasons.some(r => /Members earn about \$37\.5/.test(r.text)) && q.reasons.some(r => /Guaranteed pay/.test(r.text)))

// ── Wiring ──
const R = read('app/api/labs/trybe/route.ts')
check('Find brands reads pay from the kept entry, with your and members\' results', /payLines\(r\.raw, r\.pay_text\)/.test(R) && /estimatePay\(\{ lines: linesBy\.get\(r\.brand_id\) \|\| \[\], yours: results\.yours\.get/.test(R) && /perVideo: estBy\.get\(x\.r\.brand_id\)\?\.dollars \?\? null/.test(R))
check('each collection writes the day\'s snapshot and a failure never fails it', /mergeSnapshot\(\(snapRow\?\.value \?\? null\) as Snapshot \| null, rows, trusted\)/.test(R) && /catch \{ \/\* the snapshot is extra/.test(R))
const O = read('components/labs/TrybeOutreach.tsx')
check('brand cards show NEW, the crowd word, the pay figure and statics', /<NewChip on=\{b\.is_new\} \/>/.test(O) && /<CrowdChip crowd=\{b\.crowd\}/.test(O) && /<PayChip est=\{b\.pay_est\} payText=\{b\.pay_text\} \/>/.test(O) && /<StaticsChip on=\{b\.statics\} \/>/.test(O))
check('the pay figure never goes into a message to a brand', /never put a rate in a message to a TRYBE brand/.test(read('components/labs/TrybeFinderControls.tsx')) && !/pay_est|estimatePay/.test(read('lib/trybe-outreach.ts')))

if (failed) { console.error(`\n${failed} TRYBE pay check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
