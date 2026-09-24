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
check('each batch row shows each country', /it\.amazon!\.map\(/.test(LB) && /a\.state === 'failed'/.test(LB))

const base = { ok: false, handedOver: 0, duplicates: 0, failed: [], waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false }
const mixed = deliverySummary({ ...base, handedOver: 3, failed: [{ domain: 'amazon.fr', country: 'France', error: 'moderation' }] })
check('a mix names the failure and its reason', mixed.some((l) => /France: moderation/.test(l)) && mixed.some((l) => /^3 uploaded/.test(l)))
check('no sentence claims a hand-over', !mixed.join(' ').includes('handed to Amazon'))

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
