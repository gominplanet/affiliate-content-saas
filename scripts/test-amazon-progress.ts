// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The live Amazon upload bar on Bulk Amazon upload (Seb, 2026-10-12: "a
// running progress bar somewhere to know it's not stuck"). Moving and quiet
// must look different, and a previous run's report is never shown as this one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readAmazonProgress, clock, STALL_SECONDS } from '../lib/amazon-progress'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const now = 1_000_000_000
const start = now - 60_000
const live = {
  'amazon.com': { step: 'Uploading video', pct: 50, at: now - 2_000, done: 1, total: 4, current: 2, title: 'Air fryer review' },
  'amazon.co.uk': { step: 'Published', pct: 100, at: now - 10_000, done: 2, total: 2, current: 2 },
}
const v = readAmazonProgress(live, { since: start, now, running: true })
check('counts videos across the stores', v.done === 3 && v.total === 6, JSON.stringify(v))
check('the video being sent counts by how much of it has gone', v.overallPct === Math.round(3.5 / 6 * 100), String(v.overallPct))
check('a store still working is listed first', v.rows[0].domain === 'amazon.com' && !v.rows[0].finished && v.rows[1].finished)
check('fresh reports are not called quiet', !v.quiet && v.quietFor === 2)

const old = { 'amazon.com': { step: 'Published', pct: 100, at: start - 600_000, done: 3, total: 3 } }
check('a previous run is not shown as this one', readAmazonProgress(old, { since: start, now, running: true }).rows.length === 0)

const stuck = { 'amazon.com': { step: 'Publishing', pct: null, at: now - (STALL_SECONDS + 5) * 1000, done: 0, total: 2, current: 1 } }
const s = readAmazonProgress(stuck, { since: now - 600_000, now, running: true })
check('no word from SCOUT for three minutes is said as quiet', s.quiet && (s.quietFor ?? 0) >= STALL_SECONDS)
check('a step with no size has no made up percentage', s.rows[0].pct === null)

const older = { 'amazon.com': { step: 'Uploading video', pct: 40, at: now - 1_000 } }
const o = readAmazonProgress(older, { since: start, now, running: true })
check('an older SCOUT without counts still shows its step and percentage', o.rows.length === 1 && o.rows[0].pct === 40 && o.total === null && o.overallPct === null)

const bg = readAmazonProgress({ 'amazon.de': { step: 'Uploading video', pct: 10, at: now - 5_000, done: 0, total: 1, current: 1 } }, { since: null, now, running: false })
check('an upload from the background tab shows while the page is open', bg.rows.length === 1 && !bg.quiet)
check('a finished background run shows nothing', readAmazonProgress({ 'amazon.de': { step: 'Published', at: now - 5_000, done: 1, total: 1 } }, { since: null, now, running: false }).rows.length === 0)
check('a stale background report shows nothing', readAmazonProgress({ 'amazon.de': { step: 'Uploading video', at: now - 600_000 } }, { since: null, now, running: false }).rows.length === 0)
check('clock reads minutes and seconds', clock(245) === '4:05' && clock(3725) === '1:02:05')

const bgjs = read('extension/background.js')
check('SCOUT says which video of how many per store', /setSfProgress\(domain, \{ total: jobs\.length, done: jobNo - 1, current: jobNo/.test(bgjs) && /pct: r\.ok \? 100 : null, done: jobNo \}/.test(bgjs))
const manifest = JSON.parse(read('extension/manifest.json'))
check('SCOUT version bumped in lockstep', /SCOUT_LATEST_VERSION = '1\.46\.1'/.test(read('lib/scout-version.ts')) && manifest.version === '1.46.1')
const lb = read('components/launch/LaunchBoard.tsx')
check('Bulk Amazon upload shows the live bar', /<AmazonProgress running=\{amazonBusy\}/.test(lb) && /onSending: \(n\) => setAmazonRun/.test(lb))
check('the listing count is passed out before SCOUT starts', /scope\?\.onSending\?\.\(sendNow\.length\)[^\n]*\n\s*const res = await requestStorefrontDelivery\(sendNow\)/.test(read('lib/storefront-delivery.ts')))

if (failed) { console.error(`\n${failed} Amazon progress check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
