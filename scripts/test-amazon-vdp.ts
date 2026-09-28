// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon videos matched to their products from each video's public page
// (lib/amazon-vdp, lib/amazon-video-products), instead of a tab per product.
import { readFileSync } from 'node:fs'
import { parseVdpPage, vdpIdFromAci } from '../lib/amazon-vdp'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

const ID = '0004658d53a34661a39e9c18838972fe'
const OTHER = '050ec48b948c40ebb7bc3fd89895fcf4'
// The shapes the live page carries (captured September 28): the video's own
// object, escaped once, with its carousel; the seed attribute as entities; and
// a recommendation elsewhere on the page naming a different product.
const page = (id: string) => `<html><head><title>Watch Why is this My FIRST EVER Suitcase of its Kind? on Amazon Live</title></head><body>
<script>var s = "{\\"id\\":\\"${id}\\",\\"channelTitle\\":\\" \\",\\"slateImageUrl\\":\\"x\\",\\"creatorType\\":\\"Influencer\\",\\"carouselItems\\":[\\"B0GL85L61L\\"],\\"vendorTrackingId\\":\\"onamzgomin0e-20\\"}"</script>
<div data-state="{&#034;id&#034;:&#034;${id}&#034;,&#034;source&#034;:&#034;VSE&#034;,&#034;asin&#034;:&#034;B0GL85L61L&#034;,&#034;contentSeedId&#034;:&#034;${id}&#034;}"></div>
${'x'.repeat(9000)}
<script>var rec = "{\\"id\\":\\"ffffffffffffffffffffffffffffffff\\",\\"carouselItems\\":[\\"B0DVBL912R\\"]}"</script>
</body></html>`

{
  const r = parseVdpPage(page(ID), ID)
  check('the video\'s own products are read, and a recommendation elsewhere on the page is not',
    r.state === 'ok' && r.asins.join() === 'B0GL85L61L', JSON.stringify(r))
  check('the tracking id and title come with it', r.state === 'ok' && r.trackingId === 'onamzgomin0e-20' && r.title === 'Why is this My FIRST EVER Suitcase of its Kind?')
  check('a page for another video is not read as this one', parseVdpPage(page(ID), OTHER).state === 'not-found')
  check('a robot check is blocked, not "no products"', parseVdpPage('<form action="/errors/validateCaptcha">Type the characters you see</form>', ID).state === 'blocked')
  check('a page with the video and no product says so', parseVdpPage(`<script>"{\\"id\\":\\"${ID}\\",\\"carouselItems\\":[]}"</script>`, ID).state === 'no-products')
  check('the page id is the hex part of the video id', vdpIdFromAci(`amzn1.vse.video.${ID.toUpperCase()}`) === ID && vdpIdFromAci('amzn1.vse.image.abc') === null)
}

{
  const J = read('lib/amazon-video-products.ts')
  check('a video is marked read only after its page answered; robot checks and failures are left for the next run',
    /if \(r\.state === 'blocked'\) \{[\s\S]*?return\s*\}/.test(J) && /if \(r\.state === 'error'\) \{ out\.errors\+\+; return \}/.test(J))
  check('three robot checks in a row stop the run', /\+\+blockedRun >= 3\) stop = 'blocked'/.test(J))
  check('no more than three pages at once, with a pause between pages', /Math\.min\(3,/.test(J) && /await pause\(\)/.test(J))
  check('one page first, alone, and nothing more if Amazon blocks it', /await one\(queue\.shift\(\) as string\)\s*if \(out\.blocked\) stop = 'blocked'/.test(J))
  const C = read('app/api/cron/amazon-video-products/route.ts')
  check('the cron stops for the minute when Amazon blocks', /stoppedFor === 'blocked'\) break/.test(C) && /CRON_SECRET/.test(C))
  check('the cron is scheduled', /"\/api\/cron\/amazon-video-products"/.test(read('vercel.json')))
  const B = read('components/brand-recap/BrandRecap.tsx')
  check('Brand recap reads on the server first and uses SCOUT only as the fallback',
    /const out = await readAllVideoProducts/.test(B) && /if \(fallback\) await findAmazonVideosWithScout\(fallback\)/.test(B))
  check('Earnings no longer depends on the SCOUT per-video replay', /readAllVideoProducts\(/.test(read('app/(dashboard)/earnings/page.tsx')) && !/startVideoProductsScan\(/.test(read('app/(dashboard)/earnings/page.tsx')))
  const X = read('extension/background.js')
  check('SCOUT\'s product-page lookups share one background tab', /chrome\.tabs\.create\(\{ url, active: false \}\)[\s\S]{0,200}AMZ_VIDEO_TAB_KEY/.test(X) && /async function scanAmazonVideoInBackground/.test(X))
}

// ── When Amazon pauses MVP's server: SCOUT reads the pages, by fetch, no tab ──
{
  const X = read('extension/background.js')
  const a = X.indexOf('function parseVdpPageJs'), b = X.indexOf('async function readVdpPages')
  // eslint-disable-next-line no-new-func
  const parseJs = new Function(`${X.slice(a, b)}; return parseVdpPageJs`)() as (h: string, id: string) => { state: string; asins?: string[] }
  const js = parseJs(page(ID), ID), ts = parseVdpPage(page(ID), ID)
  check('SCOUT\'s parser answers exactly as the server\'s', JSON.stringify(js) === JSON.stringify({ state: ts.state, asins: ts.state === 'ok' ? ts.asins : undefined }) && parseJs(page(ID), OTHER).state === 'not-found', JSON.stringify(js))
  check('SCOUT reads by fetch with no tab, at a person\'s pace, and stops at three robot checks',
    /fetch\(`https:\/\/www\.amazon\.com\/vdp\/\$\{id\}`/.test(X.slice(b, b + 1500)) && !/chrome\.tabs\.create/.test(X.slice(b, b + 1500)) && /\+\+blockedRun >= 3\) break/.test(X))
  check('SCOUT may fetch video pages', /"https:\/\/www\.amazon\.com\/vdp\/\*"/.test(read('extension/manifest.json')))
  const F = read('lib/extension-frame.ts')
  check('an older SCOUT is told to update instead of being waited on', /_cmpVersion\(st\.version, '1\.21\.20'\) < 0\) return \{ ok: false, error: 'needs-update' \}/.test(F))
  const J = read('lib/amazon-video-products.ts')
  check('what SCOUT reads only touches the creator\'s own videos, and a blocked read is not marked read',
    /if \(!own\.has\(aci\)\) continue/.test(J) && /if \(r\.state === 'blocked'\) \{ out\.blocked\+\+; continue \}/.test(J))
  check('Brand recap turns to SCOUT\'s page reads before any product-by-product lookup',
    /const viaScout = await readVideoProductsViaScout/.test(read('components/brand-recap/BrandRecap.tsx')))
  const B = read('lib/brand-content-server.ts')
  check('every product\'s brand is looked up when the lookup function exists', /for \(let i = 0; i < lookFor\.length; i \+= 1000\)/.test(B) && !/missing\.slice\(0, 600\)/.test(B))
}

if (failures.length) {
  console.error(`\n❌ amazon-vdp: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ amazon-vdp: every Amazon video matched from its own public page, with no tabs')
