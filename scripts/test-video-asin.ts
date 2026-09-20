// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE ASIN IS IN THE VIDEO'S OWN DESCRIPTION, SO STOP ASKING FOR IT.
//
// Storefront Sync required a Featured ASIN typed by hand on every video, while
// the answer sat in the description the whole time:
//
//   Check Today's Price and Availability on AMAZON here:
//   https://www.mvpl.ink/2eniqan
//
// That is a BRANDED Geniuslink domain. An earlier version of the back catalogue
// carried a list of known shorteners (geni.us, amzn.to, bit.ly) and reported
// every video on that channel as having no product attached. A host list will
// always be missing somebody's domain, so there is no list: anything
// allProductUrls is willing to call a product link gets followed.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ROUTE = live(read('app/api/video-asin/route.ts'))
const LIB = live(read('lib/product-link.ts'))
const STAGE_RAW = read('components/launchpad/StorefrontStage.tsx')

// ── the ASIN is looked up, not demanded ─────────────────────────────────────
{
  check('picking a video looks the product up',
    /fetch\(`\/api\/video-asin\?videoId=/.test(STAGE_RAW),
    'the answer is in the description; asking for it once per video is the work MVP exists to remove')
  check('and the route follows the links rather than only reading columns',
    /resolveAsinFromLinks/.test(ROUTE),
    'youtube_videos.asin is empty on most of a catalogue, and product_url often is too')
}

// ── no list of shorteners, anywhere ─────────────────────────────────────────
{
  check('the resolver takes whatever allProductUrls returns',
    /allProductUrls\(text, ownSite, max\)/.test(LIB),
    'a branded Geniuslink domain is still a product link, and a host list will always miss one')
  check('and it is not gated on a host list',
    !/geni\\?\.us\|.*amzn/.test(LIB.split('resolveAsinFromLinks')[1] ?? ''),
    'the list is the bug that reported a whole channel as having no product')
}

// ── it prefills, it does not take over ──────────────────────────────────────
{
  check('a creator who typed something is never overwritten',
    /asinTouched\.current = true/.test(STAGE_RAW) && /if \(asinTouched\.current\) return/.test(STAGE_RAW),
    'silently replacing what someone typed into a required field is worse than not helping')
  check('and the screen says where the ASIN came from',
    /Found in \{asinAuto\.from\}/.test(STAGE_RAW),
    'a required field that fills itself and says nothing leaves the creator guessing what it will tag')
  check('a lookup that found nothing says so rather than leaving it blank',
    /No Amazon product link in this video/.test(STAGE_RAW),
    'an empty field and a field nobody could fill look identical')
}

// ── a failed lookup is not a verdict ────────────────────────────────────────
{
  check('a resolver that fell over says it could not check',
    /could not follow the product link just now/.test(ROUTE),
    'reporting a failed lookup as "no product" sends the creator hunting for a link that is right there')
  check('and the answer is cached on the video',
    (ROUTE.match(/update\(\{ asin:/g) ?? []).length >= 2,
    'migration 204 exists so this redirect is followed once, not on every visit')
  check('a saved ASIN is used without a second opinion',
    /from: 'saved'/.test(ROUTE),
    're-following a link MVP already resolved spends a request to learn what it knew')
}

if (failures.length) {
  console.error(`\n❌ video-asin: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ video-asin: the product link in the description answers the ASIN field, and says where it came from')
