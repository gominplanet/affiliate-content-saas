// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// An Amazon Live from your TRYBE samples (Seb, 2026-11-18: "I've received
// samples from Tribe. If they exist on Amazon, let's have MVP figure that out
// and then create a live show based on those products").

import { readFileSync } from 'node:fs'
import { sameProduct, findListing, liveSamples, remembered, lineupWords, RECHECK_DAYS, type SampleRow, type LiveTrybeItem } from '../lib/live-trybe'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. The same product: the brand's, with every one of its own words
check('the brand’s listing with the product’s words is the product', sameProduct('Atom Air earbuds', 'Audien', { asin: 'B0AAAAAAA1', title: 'Audien Atom Air Wireless Earbuds, Black' }))
check('another brand’s listing with the same words is not', !sameProduct('Atom Air earbuds', 'Audien', { asin: 'B0AAAAAAA2', title: 'Sony Atom Air Earbuds' }))
check('a listing missing one of the words is not', !sameProduct('Atom Air earbuds', 'Audien', { asin: 'B0AAAAAAA3', title: 'Audien Atom Earbuds' }))
check('Keepa’s brand field counts as the brand', sameProduct('Clarity hearing aid', 'Audien', { asin: 'B0AAAAAAA4', title: 'Clarity Rechargeable Hearing Aid', brand: 'AUDIEN' }))
check('one of the brand’s campaign ASINs counts as the brand', sameProduct('Vest', 'Oink', { asin: 'B0AAAAAAA5', title: 'Weighted running vest' }, new Set(['B0AAAAAAA5'])))
check('a sample named only by its brand is never matched', !sameProduct('Kings Loot', 'Kings Loot', { asin: 'B0AAAAAAA6', title: 'Kings Loot Mystery Box' }))
const hit = findListing('Atom Air earbuds', 'Audien', [
  { by: 'video', listings: [{ asin: 'B0VIDEO001', title: 'Audien Atom Air Earbuds' }] },
  { by: 'keepa', listings: [{ asin: 'B0KEEPA001', title: 'Audien Atom Air Earbuds' }] },
])
check('the sources are tried in order: your own videos first', hit?.asin === 'B0VIDEO001' && hit.by === 'video')
check('no source with it is no match', findListing('Atom Air earbuds', 'Audien', [{ by: 'storefront', listings: [{ asin: 'B0X', title: 'Audien Clarity' }] }]) === null)

// 2. The samples worth a live
const now = Date.parse('2026-11-18T12:00:00Z')
const row = (o: Partial<SampleRow> & { id: string }): SampleRow => ({ brand_name: 'Audien', product: 'Atom Air', received_at: null, filmed_at: null, submitted_at: null, ...o })
const list = liveSamples([
  row({ id: 'a', received_at: '2026-11-01T00:00:00Z' }),
  row({ id: 'b', product: 'Clarity', received_at: '2026-11-10T00:00:00Z', submitted_at: '2026-11-12T00:00:00Z' }),
  row({ id: 'c' }),
  row({ id: 'd', product: 'atom  AIR', received_at: '2026-10-01T00:00:00Z' }),
])
check('only samples you received, newest first, each product once, submitted ones too', list.map((r) => r.id).join(',') === 'b,a')
check('an answer is kept for a month, then looked up again', remembered(row({ id: 'x', amazon_checked_at: new Date(now - 2 * 86_400_000).toISOString() }), now) && !remembered(row({ id: 'y', amazon_checked_at: new Date(now - (RECHECK_DAYS + 1) * 86_400_000).toISOString() }), now) && !remembered(row({ id: 'z' }), now))

// 3. The line on the page tells found, not found and not checked apart
const item = (state: LiveTrybeItem['state']): LiveTrybeItem => ({ sampleId: state, brand: 'Audien', product: 'Atom', stage: 'to_film', state, asin: null, title: null, image: null, by: null, why: '' })
check('found, not found and not checked are each said', lineupWords([item('found'), item('none'), item('unchecked')]) === '1 of your 3 samples is on Amazon, 1 not found there, 1 not checked yet (MVP looks again next time).')
check('no sample received says what to do', /Press It arrived/.test(lineupWords([])))

// 4. Wiring
const route = read('app/api/live/trybe/route.ts')
check('the route is gated on Live Prep, TRYBE and its own switch', /canUsePreview\('amazon_live', tier\)/.test(route) && /canUsePreview\('trybe_outreach', tier\)/.test(route) && /canUsePreview\('live_trybe', tier\)/.test(route))
check('the route reads only MVP tables and Keepa, never an Amazon page', /from\('amazon_video_products'\)/.test(route) && /from\('storefront_catalog'\)/.test(route) && /from\('cc_campaign_catalog'\)/.test(route) && /fetchKeepaSearch\(/.test(route) && !/fetchAmazonProduct|amazon\.com\/dp/.test(route))
check('Keepa searches are capped per press and kept a month on the sample', /searches >= KEEPA_SEARCHES_PER_RUN/.test(route) && /amazon_checked_at: at/.test(route))
check('a source that did not answer is "not checked", never "not on Amazon"', /if \(found === null\) unanswered = /.test(route) && /state: 'unchecked'/.test(route))
check('without migration 470 it still works and says so', /memory = false/.test(route) && /needsSql: !memory && tier === 'admin'/.test(route))
const mig = read('supabase/migrations/470_trybe_samples_amazon.sql')
check('migration 470 is safe to run twice', (mig.match(/add column if not exists/g) || []).length === 4)
const ui = read('components/labs/AmazonLive.tsx')
check('Live Prep has the button, lines the matches up and names Amazon on each link', /Go live with your TRYBE samples/.test(ui) && /'Build my TRYBE live'/.test(ui) && ui.indexOf('Go live with your TRYBE samples') < ui.indexOf('Suggest a lineup') && /setPicked\(asins\)/.test(ui) && /See it on Amazon<\/a>/.test(ui) && /lineupWords\(trybeRes\.items\)/.test(ui))
check('the page shows the button only with TRYBE and the switch', /<AmazonLive trybe=\{canUsePreview\('live_trybe', tier\) && canUsePreview\('trybe_outreach', tier\)\} \/>/.test(read('app/(dashboard)/amazon-live/page.tsx')))
check('admin first', /live_trybe: 'admin'/.test(read('lib/labs-preview.ts')))

if (failures.length) {
  console.error(`test-live-trybe: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-live-trybe: all checks passed')
