// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the per-video product read pull the right things out of an unknown shape?
//
// The endpoint this replays is discovered at runtime, so its response shape is
// not known in advance and fields are found by name rather than by position. A
// key called asin holding ten characters is an ASIN wherever it sits; a key
// called duration holding a sane number of seconds is a length. That approach
// is only safe if it is fussy about what it accepts, and this is where that gets
// checked: an ASIN-shaped string under some other key must be ignored, a
// timestamp in a field called duration must not become an eleven day video, and
// the same product appearing three times in one payload must be counted once.
//
// It also checks the thing that broke the library read twice: that a video which
// fails is still marked done, because a video that stays pending forever is a
// crawl that never finishes.
import { readFileSync } from 'node:fs'

const src = readFileSync('extension/background.js', 'utf8')
function extract(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found in background.js`)
  let depth = 0, i = src.indexOf('{', start), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return src.slice(start, end)
}

globalThis.location = { href: 'https://www.amazon.com/manage-content' }
globalThis.AbortSignal = { timeout: () => null }
const fetchVideoDetailsInPage = eval(`(${extract('fetchVideoDetailsInPage')})`)

const failures = []
const check = (name, cond, detail) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

// A response shaped awkwardly on purpose: products nested three levels down, a
// decoy ten-character string under a key that is not an ASIN field, a duration
// alongside a millisecond timestamp that must not be mistaken for one, and the
// same product repeated.
const body = (aci) => ({
  content: {
    mediaACI: aci,
    versionCreationTimestamp: 1700000000000,
    videoDuration: 47,
    sections: [
      {
        widgets: [
          { product: { asin: 'B07RL8H55Z', productTitle: 'Elgato Stream Deck XL' } },
          { product: { asin: 'B07RL8H55Z', productTitle: 'Elgato Stream Deck XL' } },
          { product: { asin: 'B0G8DLXF8V', title: 'Egg Chair Cushion' } },
        ],
      },
      { referenceCode: 'ABCDEFGHIJ', trackingId: 'B0BMPPC67N' },
    ],
  },
})

let seenUrls = []
let seenBodies = []
globalThis.fetch = async (url, init) => {
  seenUrls.push(String(url))
  if (init && init.body) seenBodies.push(String(init.body))
  const m = String(url).match(/aci-\d+/)
  const aci = m ? m[0] : 'aci-0'
  if (aci === 'aci-3') return { ok: false, status: 500 }
  return { ok: true, status: 200, json: async () => body(aci) }
}

const acis = ['aci-0', 'aci-1', 'aci-2', 'aci-3', 'aci-4']
const out = await fetchVideoDetailsInPage({
  url: 'https://www.amazon.com/manage-content/api/get-content?aci=aci-SAMPLE',
  method: 'GET', headers: { 'x-thing': '1' }, body: null,
  sampleAci: 'aci-SAMPLE', acis, startedAt: Date.now(),
})

check('every video is accounted for', out.items.length === acis.length,
  `${out.items.length} of ${acis.length}`)
check('the id is substituted into the url', seenUrls.some(u => u.includes('aci-2')) && !seenUrls.some(u => u.includes('aci-SAMPLE')),
  seenUrls[0])

const ok0 = out.items.find(i => i.aci === 'aci-0')
check('products are found however deep they sit', ok0.products.length === 2,
  `found ${ok0.products.map(p => p.asin).join(', ')}`)
check('a repeated product is counted once', ok0.products.filter(p => p.asin === 'B07RL8H55Z').length === 1)
check('an ASIN-shaped string under another key is ignored',
  !ok0.products.some(p => p.asin === 'ABCDEFGHIJ' || p.asin === 'B0BMPPC67N'),
  ok0.products.map(p => p.asin).join(', '))
check('titles come across with their product',
  ok0.products.find(p => p.asin === 'B07RL8H55Z')?.title === 'Elgato Stream Deck XL',
  JSON.stringify(ok0.products))
check('a length is read when the detail call carries one', ok0.duration === 47, `duration=${ok0.duration}`)

const failed = out.items.find(i => i.aci === 'aci-3')
check('a video Amazon refuses is still marked done', !!failed && failed.failed !== null,
  'a video left pending forever is a crawl that never finishes')
check('a refused video claims no products', failed.products.length === 0)

// ── a payload with nothing usable in it ─────────────────────────────────────
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: { note: 'nothing here', lastModified: 1758000000000 } }) })
const empty = await fetchVideoDetailsInPage({
  url: 'https://x/api?aci=aci-SAMPLE', method: 'GET', headers: {}, body: null,
  sampleAci: 'aci-SAMPLE', acis: ['aci-9'], startedAt: Date.now(),
})
check('no products are invented from a payload without any', empty.items[0].products.length === 0)
check('a millisecond timestamp is not read as a video length', empty.items[0].duration === null,
  `duration=${empty.items[0].duration}`)

// ── a length whose field name declares milliseconds ─────────────────────────
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ media: { durationMs: 47000 } }) })
const ms = await fetchVideoDetailsInPage({
  url: 'https://x/api?aci=aci-SAMPLE', method: 'GET', headers: {}, body: null,
  sampleAci: 'aci-SAMPLE', acis: ['aci-11'], startedAt: Date.now(),
})
check('milliseconds are converted, not read as seconds', ms.items[0].duration === 47,
  `got ${ms.items[0].duration}, which would file a 47 second video as over three minutes`)

// ── a length too large to be seconds, whose name does not say milliseconds ──
// Unknown is the honest answer here. A wrong length lands in a band and skews
// the advice about how long the next video should be, which is worse than an
// empty panel that explains itself.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ media: { videoDuration: 47000 } }) })
const huge = await fetchVideoDetailsInPage({
  url: 'https://x/api?aci=aci-SAMPLE', method: 'GET', headers: {}, body: null,
  sampleAci: 'aci-SAMPLE', acis: ['aci-12'], startedAt: Date.now(),
})
check('an implausible length is refused rather than guessed at', huge.items[0].duration === null,
  `got ${huge.items[0].duration}`)

// ── a POST-shaped template, where the id lives in the body ──────────────────
seenUrls = []; seenBodies = []
globalThis.fetch = async (url, init) => {
  seenBodies.push(String(init.body))
  return { ok: true, status: 200, json: async () => body('aci-7') }
}
await fetchVideoDetailsInPage({
  url: 'https://x/api/detail', method: 'POST', headers: {},
  body: JSON.stringify({ mediaACI: 'aci-SAMPLE', locale: 'en_US' }),
  sampleAci: 'aci-SAMPLE', acis: ['aci-7'], startedAt: Date.now(),
})
check('the id is substituted into a request body too',
  seenBodies[0].includes('aci-7') && !seenBodies[0].includes('aci-SAMPLE'), seenBodies[0])

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
