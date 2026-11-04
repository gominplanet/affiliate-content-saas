// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// UP TO THREE PRODUCTS ON ONE AMAZON VIDEO (Bulk Amazon upload).
//
// Douglas Brinkley, 2026-11-04: "When I post Amazon videos I typically tag up
// to three variations. However, the bulk upload only allows you to list one
// ASIN." Seb: build the three, the exact products, never the parent ASIN.
//
// Pinned here: what the Product box takes, what is kept, which listing gets
// the other products, what SCOUT tags (and what it does when Amazon will not
// take one), and that the saved line says what really went on the video.
import { readFileSync } from 'node:fs'
import {
  MAX_PRODUCTS_PER_VIDEO, splitProductInput, uniqueAsins, cleanMoreAsins, productBoxText,
  moreAsinsForListing, taggedLine, withTagged,
} from '../lib/launch-products'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ── WHAT WAS PASTED ─────────────────────────────────────────────────────────
check('three is the most', MAX_PRODUCTS_PER_VIDEO === 3)
check('one ASIN is one product', same(splitProductInput('B0FR4RHHXF'), ['B0FR4RHHXF']))
check('spaces, commas, semicolons and new lines separate products',
  same(splitProductInput('B0AAAAAAAA B0BBBBBBBB,B0CCCCCCCC'), ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC'])
  && same(splitProductInput('B0AAAAAAAA;\nB0BBBBBBBB ,  B0CCCCCCCC,'), ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC']))
check('two links glued by a comma are two products',
  same(splitProductInput('https://www.amazon.com/dp/B0AAAAAAAA,https://amzn.to/abc'), ['https://www.amazon.com/dp/B0AAAAAAAA', 'https://amzn.to/abc']))
check('a link keeps a comma that belongs to it',
  same(splitProductInput('https://www.amazon.com/s?k=red,blue'), ['https://www.amazon.com/s?k=red,blue']))
check('a link then an ASIN after a comma are two products',
  same(splitProductInput('https://amzn.to/abc,B0BBBBBBBB'), ['https://amzn.to/abc', 'B0BBBBBBBB']))
check('nothing pasted is no products', splitProductInput('   ').length === 0 && splitProductInput(',, ;').length === 0)

// ── WHAT IS KEPT ────────────────────────────────────────────────────────────
check('ASINs are kept once each, upper case, in order', same(uniqueAsins(['b0aaaaaaaa', 'B0BBBBBBBB', 'B0AAAAAAAA', 'junk', null]), ['B0AAAAAAAA', 'B0BBBBBBBB']))
check('the others never repeat the main one and stop at two',
  same(cleanMoreAsins('B0AAAAAAAA', ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC', 'B0DDDDDDDD']), ['B0BBBBBBBB', 'B0CCCCCCCC'])
  && same(cleanMoreAsins('B0AAAAAAAA', null), []) && same(cleanMoreAsins('B0AAAAAAAA', 'B0BBBBBBBB'), []))
check('the box shows the main product first, then the others',
  productBoxText('B0AAAAAAAA', ['B0BBBBBBBB', 'B0CCCCCCCC']) === 'B0AAAAAAAA B0BBBBBBBB B0CCCCCCCC'
  && productBoxText('B0AAAAAAAA', []) === 'B0AAAAAAAA' && productBoxText(null, null) === '')

// ── WHICH LISTING GETS THE OTHERS ───────────────────────────────────────────
check('the US listing of the video\'s product gets the others',
  same(moreAsinsForListing('amazon.com', 'B0AAAAAAAA', 'B0AAAAAAAA', ['B0BBBBBBBB']), ['B0BBBBBBBB'])
  && same(moreAsinsForListing('www.amazon.com', 'b0aaaaaaaa', 'B0AAAAAAAA', ['B0BBBBBBBB']), ['B0BBBBBBBB']))
check('another country gets the video\'s product only', moreAsinsForListing('amazon.de', 'B0AAAAAAAA', 'B0AAAAAAAA', ['B0BBBBBBBB']).length === 0)
check('a listing given a different ASIN gets nothing added', moreAsinsForListing('amazon.com', 'B0ZZZZZZZZ', 'B0AAAAAAAA', ['B0BBBBBBBB']).length === 0)
check('a listing with no product gets nothing added', moreAsinsForListing('amazon.com', null, null, ['B0BBBBBBBB']).length === 0)

// ── WHAT IS SAID AFTER THE UPLOAD ───────────────────────────────────────────
check('one product and an older SCOUT: the line is as before', taggedLine({ asin: 'B0AAAAAAAA', moreAsins: [] }, {}) === null
  && withTagged('Uploaded to storefront', { asin: 'B0AAAAAAAA', moreAsins: [] }, {}) === 'Uploaded to storefront')
check('more asked for and an older SCOUT: it says only the first went on',
  /tagged B0AAAAAAAA only\. Update SCOUT to tag B0BBBBBBBB and B0CCCCCCCC too/.test(taggedLine({ asin: 'B0AAAAAAAA', moreAsins: ['B0BBBBBBBB', 'B0CCCCCCCC'] }, {}) || ''))
check('SCOUT 1.55.0 says which went on',
  withTagged('Uploaded to storefront', { asin: 'B0AAAAAAAA', moreAsins: ['B0BBBBBBBB'] }, { tagged: ['B0AAAAAAAA', 'B0BBBBBBBB'], notTagged: [] }) === 'Uploaded to storefront, tagged B0AAAAAAAA, B0BBBBBBBB')
check('one Amazon would not take is named with the reason',
  /tagged B0AAAAAAAA\. Not tagged: B0CCCCCCCC \(not sold on this store\)/.test(taggedLine({ asin: 'B0AAAAAAAA', moreAsins: ['B0CCCCCCCC'] }, { tagged: ['B0AAAAAAAA'], notTagged: [{ asin: 'B0CCCCCCCC', reason: 'not sold on this store' }] }) || ''))
check('the saved line fits the 200 characters the result keeps for the usual case',
  withTagged('Uploaded to storefront', { asin: 'B0AAAAAAAA', moreAsins: ['B0BBBBBBBB', 'B0CCCCCCCC'] }, { tagged: ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC'] }).length < 200)

// ── THE SAVE ROUTE ──────────────────────────────────────────────────────────
const ITEM = r('app/api/launch/items/[id]/route.ts')
check('the save splits what was pasted and refuses more than three', /splitProductInput\(raw\)/.test(ITEM) && /pieces\.length > MAX_PRODUCTS_PER_VIDEO/.test(ITEM))
check('each one is read the same way the single product was, links followed', /for \(const \[k, piece\] of pieces\.entries\(\)\)/.test(ITEM) && /resolveAsinFromLinks\(piece, null, 3\)/.test(ITEM))
check('a bad one is named by its place', /Product \$\{k \+ 1\}/.test(ITEM))
check('the first is the video\'s product, the others are kept apart', /patch\.asin = asins\[0\]/.test(ITEM) && /moreAsins = asins\.slice\(1\)/.test(ITEM))
check('the others are their own write, and a missing column is said, not hidden',
  /update\(\{ more_asins: moreAsins \}\)/.test(ITEM) && /migration 464/.test(ITEM) && /warning: moreWarning/.test(ITEM))
check('clearing the box clears the others too', /patch\.asin = null\s*\n\s*moreAsins = \[\]/.test(ITEM))

// ── THE BOARD ───────────────────────────────────────────────────────────────
const BATCH = r('app/api/launch/batches/[id]/route.ts')
check('the batch reads the others on their own, so an older database still loads', /select\('id,more_asins'\)/.test(BATCH) && /more_asins: moreAsinsById\.get\(i\.id\) \?\? \[\]/.test(BATCH))
const LB = r('components/launch/LaunchBoard.tsx')
check('the box shows all saved products and compares against all of them',
  /const savedProduct = productBoxText\(item\.asin, item\.more_asins\)/.test(LB) && /if \(product !== savedProduct\) body\.product = product/.test(LB) && !/product !== \(item\.asin \?\? ''\)/.test(LB))
check('the box says up to 3, the exact product, never the parent', /up to 3/i.test(LB) && /never the parent ASIN/.test(LB))
check('a save that kept only the first product says so', /if \(j\?\.warning\) toast\.error/.test(LB))

// ── THE UPLOAD ──────────────────────────────────────────────────────────────
const QUEUE = r('app/api/global-sync/deliver/queue/route.ts')
check('the queue hands SCOUT the others, read at upload time in their own query',
  /select\('video_id,asin,more_asins'\)/.test(QUEUE) && /moreAsins: moreAsinsForListing\(r\.domain as string, r\.asin as string/.test(QUEUE))
check('the queue still hands SCOUT US uploads only', /q = q\.eq\('domain', UPLOAD_MARKET\)/.test(QUEUE))
check('both upload paths save what was really tagged',
  /withTagged\(/.test(r('lib/storefront-delivery.ts')) && /withTagged\('Uploaded to storefront', byId\.get/.test(r('components/launchpad/StorefrontStage.tsx')))

// ── SCOUT 1.55.0 ────────────────────────────────────────────────────────────
const UP = r('extension/storefront-upload.js')
const BG = readFileSync('extension/background.js', 'latin1')
const M = JSON.parse(r('extension/manifest.json'))
const [ma, mi] = String(M.version).split('.').map(Number)
check('SCOUT is 1.55.0 or newer, in lockstep', (ma > 1 || (ma === 1 && mi >= 55)) && new RegExp(`SCOUT_LATEST_VERSION = '${M.version.replace(/\./g, '\\.')}'`).test(r('lib/scout-version.ts')))
check('the version that tags more than one is written down', /SCOUT_MORE_PRODUCTS_MIN_VERSION = '1\.55\.0'/.test(r('lib/scout-version.ts')))
check('the video\'s own product is still a hard gate', /if \(!job\.asin\) \{\s*throw new Error\('No product ASIN/.test(UP))
check('SCOUT\'s worker passes back which went on', /tagged: r\.tagged, notTagged:/.test(BG))
check('the migration is safe to run twice', /add column if not exists more_asins text\[\] not null default '\{\}'/.test(r('supabase/migrations/464_launch_more_asins.sql')))

// SCOUT's own publish step, run for real against a pretend Amazon.
async function scoutRuns() {
  const start = UP.indexOf('  async function asinRefusal(')
  const end = UP.indexOf('  // Is this a sign-in page?')
  const code = UP.slice(start, end)
  type Call = { path: string; body: Record<string, unknown> }
  const run = async (opts: { refuse?: string[]; refuseMulti?: boolean }) => {
    const calls: Call[] = []
    const api = async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body })
      if (path === 'asins') {
        const a = String((body.asins as string[])[0])
        const no = opts.refuse?.includes(a)
        return new Response(JSON.stringify(no ? { hasError: true, message: 'not sold here' } : { asins: [a] }), { status: 200 })
      }
      if (path === 'check-content-quality') return new Response('{}', { status: 200 })
      if (path === 'shoppable-media') {
        const products = ((body.shoppableMedias as Array<{ products: Array<{ asin: string }> }>)[0]).products
        if (opts.refuseMulti && products.length > 1) return new Response(JSON.stringify({ hasError: true, message: 'Invalid product list' }), { status: 400 })
        return new Response(JSON.stringify({ mediaAci: 'amzn1.vse.video.0123456789abcdef0123456789abcdef' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }
    const chrome = { runtime: { sendMessage: () => {} } }
    const location = { host: 'www.amazon.com' }
    let n = 0
    const uuid = () => `id-${++n}`
    const sleep = async () => {}
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const make = new Function('api', 'chrome', 'location', 'uuid', 'sleep', `${code}\nreturn { asinRefusal, publishTagged }`)
    const S = make(api, chrome, location, uuid, sleep)
    const job = { asin: 'B0AAAAAAAA', title: 'Projector review' }
    const ctx = { slateToken: 't', csrf: 'c' }
    const extras: string[] = []
    const notTagged: Array<{ asin: string; reason: string }> = []
    for (const a of ['B0BBBBBBBB', 'B0CCCCCCCC']) {
      const why = await S.asinRefusal(a, ctx)
      if (why) notTagged.push({ asin: a, reason: why }); else extras.push(a)
    }
    const out = await S.publishTagged(job, ctx, 'k/v.mp4', null, extras, notTagged)
    const posts = calls.filter((c) => c.path === 'shoppable-media').map((c) => ((c.body.shoppableMedias as Array<{ products: Array<{ asin: string }> }>)[0]).products.map((p) => p.asin))
    return { out, posts }
  }

  const all = await run({})
  check('SCOUT tags all three when Amazon takes them', all.out.ok === true && same(all.out.tagged, ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC']) && same(all.posts, [['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC']]))
  const one = await run({ refuse: ['B0CCCCCCCC'] })
  check('one Amazon will not sell here is left off and named, the upload goes on',
    one.out.ok === true && same(one.out.tagged, ['B0AAAAAAAA', 'B0BBBBBBBB']) && one.out.notTagged.length === 1 && one.out.notTagged[0].asin === 'B0CCCCCCCC' && /not sold here/.test(one.out.notTagged[0].reason))
  const multi = await run({ refuseMulti: true })
  check('a post refused with several on goes up with the video\'s product alone, and says so',
    multi.out.ok === true && same(multi.out.tagged, ['B0AAAAAAAA']) && multi.out.notTagged.length === 2
    && multi.out.notTagged.every((x: { reason: string }) => /refused the post/.test(x.reason)) && same(multi.posts[multi.posts.length - 1], ['B0AAAAAAAA']))
}

scoutRuns().then(() => {
  if (failures.length) {
    console.error(`\n❌ launch-products: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ launch-products: up to three exact products per Amazon video, the first is the video\'s, SCOUT tags the rest it can and says which went on')
}).catch((e) => { console.error('❌ launch-products crashed:', e); process.exit(1) })
