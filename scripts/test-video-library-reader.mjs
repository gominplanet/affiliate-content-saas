// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the video library reader actually finish?
//
// This crawl shipped broken four times running, and every time the failure was
// invisible from the code: it read the whole library and then reported itself
// unfinished, so the page told the creator to run it again, forever. The rule
// that caused it (an empty page only counts as the end if it is ALSO the third
// page in a row that added nothing) reads as reasonable and is not.
//
// So the reader is now run against a fake Amazon, out of the extension source
// itself, and the thing asserted is the thing that kept going wrong: that a
// complete read is reported as complete. Four shapes of answer, because Amazon
// gives all four: with and without a usable metrics request, with and without a
// total in the metadata.

// Runs the real fetchContentListInPage out of background.js against a fake
// Amazon, so the paging and end-of-library logic is tested rather than guessed.
import { readFileSync } from 'node:fs'

const src = readFileSync('extension/background.js', 'utf8')
const start = src.indexOf('function fetchContentListInPage(rec) {')
if (start < 0) throw new Error('function not found')
// Walk braces to the end of the declaration.
let depth = 0, i = src.indexOf('{', start), end = -1
for (; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
}
const fnSrc = src.slice(start, end)

globalThis.location = { href: 'https://www.amazon.com/manage-content' }
globalThis.AbortSignal = { timeout: () => null }

const LIB = 6768
let calls = []

function makeFetch({ metricsWorks, totalReported, emptyAt = null, maxSize = null, renamed = false }) {
  calls = []
  return async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ startIndex: body.startIndex, pageSize: body.pageSize, retrieveMetrics: body.retrieveMetrics })
    if (body.retrieveMetrics && !metricsWorks) return { ok: false, status: 500 }
    const from = body.startIndex
    // Seb, 2026-11-11: a page bigger than Amazon now allows comes back as a
    // good answer with no rows, not as an error.
    const tooBig = maxSize != null && body.pageSize > maxSize
    const n = (tooBig || (emptyAt != null && from >= emptyAt)) ? 0 : Math.max(0, Math.min(body.pageSize, LIB - from))
    const result = Array.from({ length: n }, (_, k) => ({
      program: 'INFLUENCER', marketplaceId: 'ATVPDKIKX0DER',
      contentDetail: {
        mediaACI: `aci-${from + k}`, description: `video ${from + k}`, state: 'PUBLISHED',
        totalProductCount: body.retrieveMetrics ? 2 : 0,
        mediaList: [{ videoDuration: body.retrieveMetrics ? 47 : 0, mediaCentralUrl: 'https://x/v.mp4' }],
        customerEngagementMetrics: body.retrieveMetrics ? { totalViews: 100, hearts: 5, averagePctViewed: 0.4, averageViewDuration: 19 } : {},
        versionCreationTimestamp: 1700000000000,
      },
    }))
    const meta = totalReported ? { totalResults: tooBig ? 0 : LIB } : {}
    return { ok: true, status: 200, json: async () => (renamed ? { contentList: result, metadata: meta } : { result, metadata: meta }) }
  }
}

const fetchContentListInPage = eval(`(${fnSrc})`)
const rec = { url: '/manage-content/api/get-content-list', method: 'POST', headers: {}, body: JSON.stringify({ pageSize: 10, startIndex: 0, retrieveMetrics: false }) }

async function crawl(cfg, label) {
  let offset = 0, saved = 0, batches = 0, variant = null, done = false, err = null, negotiations = 0, empty = null
  globalThis.fetch = makeFetch(cfg)
  const t0 = Date.now()
  while (batches < 400) {
    const before = calls.length
    const out = await fetchContentListInPage({ ...rec, startAt: offset, maxRows: 400, variant })
    // Count rejected shapes as a negotiation cost.
    negotiations += calls.slice(before).filter(c => c.retrieveMetrics && !cfg.metricsWorks).length
    batches++
    if (out.variant) variant = out.variant
    if (out.error) err = out.error
    if (out.empty) empty = out.empty
    saved += out.videos.length
    if (!out.videos.length || out.nextOffset <= offset) { done = done || out.done; break }
    offset = out.nextOffset
    if (out.done) { done = true; break }
  }
  console.log(`${label}\n  saved=${saved} batches=${batches} done=${done} variant=${JSON.stringify(variant)} err=${err} rejectedMetricCalls=${negotiations} ms=${Date.now() - t0}`)
  return { saved, done, err, negotiations, variant, empty }
}

const a = await crawl({ metricsWorks: true, totalReported: true }, 'A. metrics accepted, total reported')
const b = await crawl({ metricsWorks: false, totalReported: true }, 'B. metrics refused, total reported')
const c = await crawl({ metricsWorks: false, totalReported: false }, 'C. metrics refused, NO total reported')
const d = await crawl({ metricsWorks: true, totalReported: false, emptyAt: 3000 }, 'D. no total, library ends early at 3000')
const e = await crawl({ metricsWorks: true, totalReported: true, maxSize: 50 }, 'E. 100 a page answered with no rows (Seb, 1.60.8)')
const f = await crawl({ metricsWorks: true, totalReported: true, maxSize: 0 }, 'F. every shape answered with no rows')
const g = await crawl({ metricsWorks: true, totalReported: true, renamed: true }, 'G. the rows under another name')

const fail = []
if (a.saved !== LIB || !a.done) fail.push('A did not read the whole library')
if (b.saved !== LIB || !b.done) fail.push('B did not read the whole library')
if (c.saved !== LIB || !c.done) fail.push('C did not read the whole library or never concluded')
if (d.saved !== 3000 || !d.done) fail.push('D did not stop cleanly at the real end')
// One negotiation per run: each of the three metrics shapes refused once, never again.
if (b.negotiations > 3) fail.push(`B renegotiated metrics ${b.negotiations} times, should be 1 per run`)
if (e.saved !== LIB || !e.done || !/50 a page/.test(String(e.variant))) fail.push(`E took an empty answer for an empty library (saved ${e.saved}, ${e.variant})`)
if (f.saved !== 0 || !/no videos/.test(String(f.empty)) || !/metrics, 100 a page: \{result\(0\),metadata\} totalResults 0/.test(String(f.empty)) || !/the page request unchanged/.test(String(f.empty))) fail.push(`F did not say what every shape answered: ${f.empty}`)
if (g.saved !== LIB || !g.done) fail.push('G did not read rows sent under another name')
console.log(fail.length ? `\nFAIL:\n  ${fail.join('\n  ')}` : '\nALL PASS')
process.exit(fail.length ? 1 : 0)
