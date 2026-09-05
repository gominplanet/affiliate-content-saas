// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the per-product earnings read actually walk the whole report?
//
// This is the code behind "Every product", which has been showing ten rows and
// a banner saying it covers under 1% of the earnings, while a competitor pulls
// thousands of rows from the same report. The pagination was written blind and
// has never been exercised, because exercising it needed a browser, an
// extension and a live Amazon session.
//
// So the real function is lifted out of background.js and run against a fake
// Amazon that behaves the way that report does: no cursor in the response, and
// paging driven by an offset field inside the request body that has to be found
// by experiment. What is asserted is the thing that matters and cannot be seen
// by reading: that every row in the report comes back exactly once.
import { readFileSync } from 'node:fs'

const src = readFileSync('extension/background.js', 'utf8')

/** Lifts a `const name = ...` expression, brace-matched from its first brace. */
function lift(decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} not found in background.js`)
  let depth = 0, i = src.indexOf('{', start), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return src.slice(start, end)
}

globalThis.AbortSignal = { timeout: () => null }

// The report: 640 distinct products, served 100 at a time, no cursor anywhere,
// paging by a `startIndex` field in the request body. Anything the caller does
// not send is ignored, exactly as Amazon ignores the store filter here.
const TOTAL = 640
const PAGE = 100
let served = []
let probeKeysTried = []

function makeAmazon({ offsetField = 'startIndex', honourOffset = true, stopHonouringAfter = Infinity, pageStyle = false } = {}) {
  served = []
  probeKeysTried = []
  let answered = 0
  return async (url, init) => {
    const body = JSON.parse(init.body)
    for (const k of ['startIndex', 'offset', 'from', 'skip', 'pageNumber', 'page', 'pageIndex']) {
      if (body[k] !== undefined) probeKeysTried.push(k)
    }
    const raw = body[offsetField]
    answered++
    const listening = honourOffset && answered <= stopHonouringAfter
    // A page-number style report counts pages from one, not rows from zero.
    const start = listening && typeof raw === 'number' ? (pageStyle ? (raw - 1) * PAGE : raw) : 0
    const rows = []
    for (let i = start; i < Math.min(start + PAGE, TOTAL); i++) {
      rows.push({
        asin: `B${String(i).padStart(9, '0')}`.slice(0, 10),
        productTitle: `Product ${i}`,
        clicks: 2, orders: 1, quantity: 1,
        earningsAmount: 1.5, revenueAmount: 10,
      })
    }
    served.push({ start, rows: rows.length })
    return { ok: true, status: 200, json: async () => ({ responses: [{ reportRecords: rows }] }) }
  }
}

// The dependencies ccProducts closes over, rebuilt around the lifted source.
const harness = `
  (async (fetchImpl) => {
    const fetch = fetchImpl
    const ASIN_RE = /^[A-Z0-9]{10}$/
    ${lift('const zipTable = (root) => {')}
    ${lift('const pickKey = (obj, want, avoid) => {')}
    ${lift('const numOf = (v) => {')}
    const out = {}
    const baseStore = null
    const recipe = {
      url: 'https://affiliate-program.amazon.com/connect/api/report/earnings/search',
      headers: {},
      body: JSON.stringify({ filterOptions: { dateRange: {} }, pageSize: ${PAGE} }),
    }
    ${lift('const ccProducts = async (fromMs, toMs) => {')}
    const r = await ccProducts(0, 1)
    return { r, out }
  })
`

const failures = []
const check = (name, cond, detail) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

// ── the report pages by an offset field in the body ─────────────────────────
{
  const run = eval(harness)
  const { r, out } = await run(makeAmazon({ offsetField: 'startIndex' }))
  const asins = new Set(r.items.map(i => i.asin))
  check('the offset field is discovered', out.productPaging === 'startIndex', `found ${out.productPaging}`)
  check('every product in the report comes back', asins.size === TOTAL,
    `${asins.size} of ${TOTAL}, missing ${TOTAL - asins.size}`)
  const starts = served.filter(s => s.rows > 0).map(s => s.start).sort((a, b) => a - b)
  check('no page of the report is skipped',
    [...new Set(starts)].join(',') === [0, 100, 200, 300, 400, 500, 600].join(','),
    `pages read at offsets ${[...new Set(starts)].join(', ')}`)
}

// ── Amazon ignores the offset entirely ──────────────────────────────────────
// It does exactly this with the store filter on this same report, which is what
// doubled every figure on the page once already. Serving the same rows forever
// must stop quickly rather than spend four hundred requests collecting one page.
{
  const run = eval(harness)
  const { r } = await run(makeAmazon({ honourOffset: false }))
  check('an ignored offset does not loop', served.length < 12,
    `${served.length} requests for a report that never moved`)
  check('an ignored offset still returns the one real page', r.items.length === PAGE,
    `${r.items.length} items`)
}

// ── Amazon honours the offset and then stops ────────────────────────────────
// Same fault as above but arriving mid-crawl, which is the harder one to notice:
// the early pages are real, so the rows look right while the tail is the first
// page repeated. It has to stop, and it has to keep what it legitimately read.
{
  const run = eval(harness)
  const { r } = await run(makeAmazon({ stopHonouringAfter: 4 }))
  const asins = new Set(r.items.map(i => i.asin))
  check('a crawl that stops being answered honestly ends quickly', served.length < 12,
    `${served.length} requests`)
  check('the pages read before it went wrong are kept', asins.size >= PAGE * 2,
    `${asins.size} products kept`)
  check('no product is counted twice', r.items.length === asins.size,
    `${r.items.length} rows for ${asins.size} products`)
}

// ── a report that pages by page number rather than row offset ───────────────
{
  const run = eval(harness)
  const { r, out } = await run(makeAmazon({ offsetField: 'pageNumber', pageStyle: true }))
  const asins = new Set(r.items.map(i => i.asin))
  check('a page-number report is discovered too', out.productPaging === 'pageNumber',
    `found ${out.productPaging}`)
  check('a page-number report is read in full', asins.size === TOTAL,
    `${asins.size} of ${TOTAL}`)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
