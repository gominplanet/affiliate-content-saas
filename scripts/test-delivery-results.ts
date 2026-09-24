// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// An Amazon upload is counted from SCOUT's own answer, and the answer is kept.
//
// WHAT HAPPENED. The shared delivery helper (Launch Batch and the coverage
// board) handed listings to SCOUT and reported "N handed to Amazon" for however
// many it passed in. SCOUT answers per listing (uploaded, already there,
// failed and why), and those answers were dropped: nothing was ever marked
// delivered, every press re-offered the whole set, and a batch of two videos to
// seven countries was reported handed over while nothing reached any store.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliverySummary } from '../lib/storefront-delivery'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const root = new URL('..', import.meta.url).pathname
const code = (p: string) => readFileSync(join(root, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*import\s/.test(l))
  .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

const D = code('lib/storefront-delivery.ts')
check('every SCOUT answer is written back', /\/api\/global-sync\/deliver\/result/.test(D) && /for \(const r of rows\)/.test(D))
check('uploaded counts only listings SCOUT says went up', /if \(r\.ok\) uploaded\+\+/.test(D) && /handedOver: uploaded/.test(D),
  'counting what was passed in is how a total failure read as handed over')
check('the old count is gone', !/handedOver: items\.length/.test(D))
check('a listing SCOUT never answered for is a failure', /SCOUT did not report on this one/.test(D))
const Q = code('app/api/global-sync/deliver/queue/route.ts')
check('failed listings come back only on request', /retryFailed'\) === '1' \? \['localized', 'failed'\] : \['localized'\]/.test(Q))
const LB = code('components/launch/LaunchBoard.tsx')
check('a press retries failures, the automatic run does not', /retryFailed: !auto/.test(LB))
const BR = code('app/api/launch/batches/[id]/route.ts')
check('a country with no listing yet still shows, from the coverage grid',
  /from\('storefront_coverage'\)/.test(BR) && /state: `grid:\$\{c\.state\}`/.test(BR),
  'a video meant for seven countries showed one and said nothing about the other six')
check('each batch row shows each country', /it\.amazon!\.map\(/.test(LB) && /a\.state === 'failed'/.test(LB))

// WHICH COUNTRIES SELL THE PRODUCT, asked before launch, from the grid's own check.
const AV = code('app/api/launch/batches/[id]/availability/route.ts')
check('the batch asks the same availability function the grid uses',
  /lookupAvailability\(admin, pairs/.test(AV) && /lookupAvailability\(sb, rows/.test(code('app/api/cron/coverage-drain/route.ts')))
check('not checked and cannot check are never read as not sold',
  /if \(a === 'not_listed'\) return 'not_sold'/.test(AV) && /return 'not_checked'/.test(AV) && /'cannot_check'/.test(AV))
check('the countries step shows it', /\/availability`/.test(LB) && /Not sold: \$\{notSold/.test(LB))

const base = { ok: false, handedOver: 0, duplicates: 0, failed: [], waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false }
const mixed = deliverySummary({ ...base, handedOver: 3, failed: [{ domain: 'amazon.fr', country: 'France', error: 'moderation' }] })
check('a mix names the failure and its reason', mixed.some((l) => /France: moderation/.test(l)) && mixed.some((l) => /^3 uploaded/.test(l)))
check('no sentence claims a hand-over', !mixed.join(' ').includes('handed to Amazon'))

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
