// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A TEMPORARY SITE ADDRESS IS SWAPPED OUT OF DESCRIPTIONS, AND ONLY IT.
//
// A creator's YouTube descriptions linked to his host's temporary address
// because his site was connected before his domain was (lib/domain-swap,
// app/api/admin/domain-swap).
import { readFileSync } from 'node:fs'
import { swapDomain, normalizeHost, isTemporaryHost, countHost } from '../lib/domain-swap'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const TEMP = 'whitesmoke-viper-123456.hostingersite.com'
const desc = `My review: http://${TEMP}/my-review/\nAlso https://www.${TEMP}/?p=4\nShop: https://amzn.to/abc\nNot me: https://not${TEMP}/x`

const out = swapDomain(desc, TEMP, 'https://www.ThumbsUp.com/')
check('paths are kept and https is used', out.includes('https://thumbsup.com/my-review/') && out.includes('https://thumbsup.com/?p=4'))
check('other links are untouched', out.includes('https://amzn.to/abc'))
check('a longer host that ends the same way is untouched', out.includes(`https://not${TEMP}/x`))
check('nothing of the old address is left', countHost(out, TEMP) === 0 && countHost(desc, TEMP) === 2)
check('the same address both ways changes nothing', swapDomain(desc, TEMP, TEMP) === desc)
check('hosts are normalised', normalizeHost('https://www.Example.com/path?q=1') === 'example.com' && normalizeHost('not a host') === '')
check('a Hostinger temporary address is recognised', isTemporaryHost(TEMP) && !isTemporaryHost('thumbsup.com'))

const ROUTE = readFileSync('app/api/admin/domain-swap/route.ts', 'utf8')
const YT = readFileSync('services/youtube/index.ts', 'utf8')
check('the route is admin only', /tier !== 'admin'/.test(ROUTE))
check('nothing is pointed at an address that does not answer', /if \(!site\.ok\) return NextResponse\.json\(\{ ok: false, error: `Nothing was changed/.test(ROUTE))
check('a temporary address is never the new one', /if \(isTemporaryHost\(to\)\)/.test(ROUTE))
check('post and site addresses change only once WordPress has moved', /if \(wordpressMoved\) \{/.test(ROUTE))
check('each run is capped', /const SWAP_PER_RUN = 25/.test(ROUTE))
check('the live description is read and title and tags are kept',
  /async swapDescriptionDomain[\s\S]{0,400}this\.get<any>\('\/videos', \{ part: 'snippet', id: videoId \}\)[\s\S]{0,900}snippet\.tags = snip\.tags/.test(YT))
check('a refused update is reported, not counted as changed',
  /async swapDescriptionDomain[\s\S]{0,1800}if \(!res\.ok\) throw new Error/.test(YT))

if (failures.length) {
  console.error(`❌ domain swap: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ domain swap: only the old address changes, never to a dead site')
