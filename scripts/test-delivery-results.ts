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
check('every failed listing comes back on a press, only due ones automatically, and none otherwise',
  /retryFailed'\) === '1' \? 'all'/.test(Q) && /m === 'all' \? q\.in\('state', \['localized', 'failed'\]\)/.test(Q)
  && /: q\.in\('state', \['localized'\]\)/.test(Q) && /next_try_at\.lte\./.test(Q))
check('a failed record is said, not counted as done', /recorded = w\.ok/.test(D) && /if \(!recorded && \(r\.ok \|\| dup\)\) unrecorded\+\+/.test(D))
check('an empty country list sends nothing', /scope\.domains\.length === 0\) \{\s*return \{ \.\.\.empty, error:/.test(D))
check('only listings that will go count against the daily limit',
  /if \(!i\.videoUrl \|\| !i\.title \|\| i\.audioIsMasterFallback\) \{ withinCap\.push\(i\); continue \}/.test(Q),
  'five waiting dubs ahead of three ready ones meant nothing uploaded and "limit reached"')
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
  /lookupRegional\(admin, pairs/.test(AV) && /lookupAvailability\(sb, norm/.test(code('lib/regional-listing.ts'))
  && /lookupAvailability\(sb, rows/.test(code('app/api/cron/coverage-drain/route.ts')))
const RL = code('lib/regional-listing.ts')
check('not checked and cannot check are never read as not sold',
  /a === 'not_listed' \? 'not_sold'/.test(RL) && /a === 'no_answer' \? 'cannot_check' : 'not_checked'/.test(RL)
  && /verdict: 'not_checked'/.test(AV))
check('a No under the US ASIN is not a No until barcode and name were tried',
  /verdict: noServer \? 'cannot_check' : 'not_checked'/.test(RL)
  && /pickEquivalent\(/.test(RL) && /pickByName\(/.test(RL))
check('a local listing is checked for stock, never assumed', /lookupAvailability\(sb, localPairs/.test(RL))
check('the hand-off uploads to the local listing it found',
  /cachedLocalAsins\(sb, String\(it\.asin\), markets\)/.test(code('app/api/cron/launch-drain/route.ts'))
  && /asin: local\.get\(domain\) \?\? it\.asin/.test(code('app/api/cron/launch-drain/route.ts')))
check('only a country checked in full and not sold is hidden, and it is named',
  /row\.byVideo\.every\(\(v\) => v\.verdict === 'not_sold'\)/.test(LB) && /Not sold in: \{hidden\.map/.test(LB)
  && /!notSoldAnywhere\(m\.domain\) \|\| batch\.markets\.some/.test(LB))
check('a mixed country says how many videos it sells', /of \$\{n\} \$\{videos\(n\)\} sold here, and only those upload/.test(LB))

// AUSTRALIA, from the live store through SCOUT: no Keepa there.
const BG = readFileSync(join(root, 'extension/background.js'), 'utf8')
const storeFn = BG.slice(BG.indexOf('async function checkStoreProducts'), BG.indexOf('// ── Amazon video lookups: ONE background tab'))
check('SCOUT checks a store by fetch and opens no tab',
  storeFn.length > 0 && /fetch\(`https:\/\/www\.\$\{host\}\/dp\//.test(BG) && !/chrome\.tabs\.create/.test(storeFn))
check('a robot check stops the run and is never read as not sold',
  /if \(own\.status === 'blocked'\) \{ blocked = true; results\.push\(\{ asin, status: 'unknown'/.test(storeFn))
check('SCOUT confirms a local listing on its own page before naming it',
  /const local = await _storeDp\(host, best\.asin\)/.test(storeFn) && /if \(local\.status === 'found'\)/.test(storeFn))
check('the message is wired', /msg\.type === 'MVP_AMZ_STORE_CHECK'/.test(BG) && /type: 'MVP_AMZ_STORE_CHECK'/.test(code('lib/extension-frame.ts')))
const PA = code('lib/product-availability.ts')
check('the shared cache answers Australia before it is called unanswerable',
  PA.indexOf("from('passport_asin_market')") < PA.indexOf("answers.set(key(r.asin, r.domain), 'no_answer')"))
check('only definite SCOUT answers are kept', /if \(r\.status !== 'not-listed'\) continue/.test(RL) && /recordStoreCheck\(admin, mkt\.domain, results\)/.test(AV))
check('the POST takes answers only for a country no server can check, and only for this batch',
  /mkt\.keepa != null\) return NextResponse\.json/.test(AV) && /mine\.has\(/.test(AV))
check('the countries step says why Australia is unchecked when it is a switch to turn on',
  /Turn on International Amazon in the SCOUT popup/.test(LB) && /requestStoreCheck\(d, scoutItems\)/.test(LB))
check('the countries step shows it', /\/availability`/.test(LB) && /Not sold: \$\{notSold/.test(LB))

const base = { ok: false, handedOver: 0, duplicates: 0, failed: [], waitingOnDub: 0, atCap: [], dailyRoom: [], nothingReady: false }
const mixed = deliverySummary({ ...base, handedOver: 3, failed: [{ domain: 'amazon.fr', country: 'France', error: 'moderation' }] })
check('a mix names the failure and its reason', mixed.some((l) => /France: moderation/.test(l)) && mixed.some((l) => /^3 uploaded/.test(l)))
check('no sentence claims a hand-over', !mixed.join(' ').includes('handed to Amazon'))

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
