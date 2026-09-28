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
    /if \(r\.state === 'blocked'\) \{[\s\S]*?continue/.test(J) && /if \(r\.state === 'error'\) \{ out\.errors\+\+; continue \}/.test(J))
  check('three robot checks in a row stop the run', /\+\+blockedRun >= 3\) stop = 'blocked'/.test(J))
  check('no more than six pages at once', /Math\.min\(6,/.test(J))
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

if (failures.length) {
  console.error(`\n❌ amazon-vdp: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ amazon-vdp: every Amazon video matched from its own public page, with no tabs')
