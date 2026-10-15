// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR ADS, LIVE (Seb, 2026-10-14, after Rob's Oink Suite video: "build all
// 4"). The creator's own ad results on TRYBE, read through SCOUT 1.47.0:
// a number TRYBE did not send is "not sent", never 0; totals TRYBE leaves out
// are added up from the videos; the winners on ads feed the double down
// stage; an older SCOUT says so and still shows what you earned.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readAdTotals, readAdVideos, fillTotals, readCount, paceOf, adBrands, adWinners, bestVideos, NO_TOTALS } from '../lib/trybe-ads'
import { stageOf } from '../lib/trybe-finder'
import type { Judged, MyBrand } from '../lib/trybe-mybrands'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── Totals, by the names TRYBE uses ──
const t = readAdTotals({ success: true, data: { totalEarnings: 412.5, activeAds: 6, metrics: { impressions: 120000, linkClicks: 940, linkCtr: 0.78, thumbstopRate: 31.4, avgWatched: 4.2, avgWatchPercent: 22 } } })
check('totals are read on the answer or inside its metrics', t.earned === 412.5 && t.liveAds === 6 && t.impressions === 120000 && t.clicks === 940 && t.ctr === 0.78 && t.hookRate === 31.4 && t.avgWatchSec === 4.2 && t.avgWatchPct === 22, JSON.stringify(t))
const none = readAdTotals({ data: { somethingElse: 1 } })
check('a number TRYBE did not send is not known, never 0', readCount(none) === 0 && none.earned === null && none.hookRate === null)
check('a { value } shape and earnings in cents are read', readAdTotals({ summary: { impressions: { value: 50 } } }).impressions === 50 && readAdTotals({ earningsCents: 1234 }).earned === 12.34)

// ── Videos ──
const vids = readAdVideos({ data: [
  { id: 'sub-1', title: 'Glow serum hook A', brandName: 'Glow', brandId: 'brand-glow', thumbnailUrl: 'https://x/1.jpg', earnings: 120, hookRate: 40, ctr: 1.2, impressions: 30000, isActive: true },
  { id: 'sub-2', title: 'Glow serum hook B', brandName: 'Glow', brandId: 'brand-glow', earnings: 30, metrics: { thumbstopRate: 20, linkCtr: 0.5, impressions: 10000 }, isActive: false },
  { id: 'sub-3', brand: { id: 'brand-zap', name: 'Zap' }, earnings: 0, hookRate: 12, impressions: 5000 },
  { title: 'no id, skipped' },
] })
check('each video is read with its brand, results and live state', vids.length === 3 && vids[0].brand === 'Glow' && vids[0].live === true && vids[1].hookRate === 20 && vids[1].ctr === 0.5 && vids[2].brand === 'Zap' && vids[2].live === null, JSON.stringify(vids.map(v => [v.id, v.brand, v.hookRate, v.live])))
const filled = fillTotals({ ...NO_TOTALS, earned: 999 }, vids)
check('totals TRYBE left out are added up from the videos; a total it sent wins', filled.earned === 999 && filled.impressions === 45000 && filled.liveAds === 1)
check('rates are weighted by impressions', Math.abs((filled.hookRate as number) - (40 * 30000 + 20 * 10000 + 12 * 5000) / 45000) < 1e-9)

// ── Pace, brands, winners ──
check('the pace compares a day this week with a day this month', paceOf(140, 300)?.dir === 'up' && paceOf(20, 300)?.dir === 'down' && paceOf(70, 300)?.dir === 'steady' && paceOf(null, 300) === null && paceOf(50, 0) === null)
const brands = adBrands(vids)
check('results per brand, most earned first', brands[0].brand === 'Glow' && brands[0].earned === 150 && brands[0].videos === 2 && brands[0].live === 1 && brands[1].brand === 'Zap')
const wins = adWinners(brands, 30)
check('a winner earned in the window and hooks at least as well as your typical video', wins.length === 1 && wins[0].brand === 'Glow' && /\$150 from your ads in 30 days, hook rate/.test(wins[0].why) && /1 live now/.test(wins[0].why), JSON.stringify(wins))
check('best videos: most earned, then hook rate', bestVideos(vids)[0].id === 'sub-1' && bestVideos(vids).length === 3)

// ── The stage counts ad winners ──
const mb = (name: string): MyBrand => ({ id: name, name, logo: null, earnings: 0, submitted: 3, approved: 1, pending: 0, rejected: 0, enrolledAt: null, programs: [] })
const judged: Judged[] = [{ brand: mb('Zap'), verdict: 'early', why: '', rate: null, exactRate: false, perVideo: null }]
const st = stageOf(judged, wins)
check('a brand winning on ads makes it a winner, with why', st.stage === 'double' && st.winners.includes('Glow') && st.adWins[0].brand === 'Glow')
check('without ad results the stage judges as before', stageOf(judged).stage === 'volume' && stageOf(judged, null).adWins.length === 0)

// ── SCOUT 1.47.0 and the wiring ──
const bg = read('extension/background.js')
const allow = bg.slice(bg.indexOf('const TRYBE_API_ALLOW'), bg.indexOf('\n]\n', bg.indexOf('const TRYBE_API_ALLOW')) + 2)
const added = allow.slice(allow.indexOf('1.47.0 (Your ads, live'))
check('SCOUT 1.47.0 reads your analytics, per video and per brand, and only reads', added.includes('analytics(\\/submissions)?') && added.includes('\\/stats(') && added.split('\n').filter(l => /method:/.test(l)).length === 3 && added.split('\n').filter(l => /method:/.test(l)).every(l => /method: 'GET'/.test(l)))
const manifest = JSON.parse(read('extension/manifest.json'))
check('SCOUT is 1.47.0 or newer, the same everywhere', /^1\.(4[7-9]|[5-9]\d)\./.test(manifest.version) && read('lib/scout-version.ts').includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`))
const hook = read('components/labs/useTrybeAds.ts')
check('an older SCOUT, signed out and a failed read are each said in their own words', /error === 'not-allowed' \? \{ kind: 'old'/.test(hook) && /kind: 'signedout'/.test(hook) && /What you earned with each brand is shown instead/.test(hook))
check('an older SCOUT still shows what you earned, from your brand totals', /brands\/stats\?period=\$\{period\}/.test(hook) && /source: 'earnings'/.test(hook))
const ui = read('components/labs/TrybeAds.tsx')
check('a number not sent reads "not sent", and an answer with none says so', /\{v \?\? 'not sent'\}/.test(ui) && /Nothing is shown as zero/.test(ui))
check('an older SCOUT shows only Earned, never a row of empty tiles', /TILES\.filter\(\(x\) => full \|\| x\.key === 'earned'\)/.test(ui))
check('My brands opens with Your ads, live, and the stage reads ad winners', /<TrybeAds canRead=\{canMyBrands\}/.test(read('components/labs/TrybeOutreach.tsx')) && /stageOf\(judgeBrands\(readBrandStats\(r\.json\)\), ads\)/.test(read('components/labs/TrybeStage.tsx')))

if (failed) { console.error(`\n${failed} TRYBE ads check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
