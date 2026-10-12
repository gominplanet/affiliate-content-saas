// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The store the creator links first is the store the post sells (Jarrett,
// 2026-10-12: Walmart links in the video, "get the best price on Amazon" on
// the blog post).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { leadingWalmartLink, isWalmartUrl } from '../lib/store-link'
import { renderPriceStrip } from '../lib/price-strip'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

check('Walmart Creator short links, walmart.com and goto.walmart.com are Walmart', isWalmartUrl('https://walmrt.us/3Abc12') && isWalmartUrl('https://www.walmart.com/ip/Thing/123') && isWalmartUrl('https://goto.walmart.com/c/1/2/3') && !isWalmartUrl('https://notwalmart.com.evil.tld/x'))
check('a description that leads with Walmart sells on Walmart', leadingWalmartLink('Get it here: https://walmrt.us/3Abc12\nAlso on Amazon: https://amzn.to/xyz') === 'https://walmrt.us/3Abc12')
check('Walmart alone, with no Amazon link, sells on Walmart', leadingWalmartLink('Shop: https://www.walmart.com/ip/Fan/12345') === 'https://www.walmart.com/ip/Fan/12345')
check('a description that leads with Amazon stays Amazon', leadingWalmartLink('Buy: https://amzn.to/xyz\nWalmart: https://walmrt.us/3Abc12') === null)
check('a Geniuslink first counts as Amazon', leadingWalmartLink('https://geni.us/abc then https://walmrt.us/3Abc12') === null)
check('socials before the Walmart link do not count', leadingWalmartLink('https://youtube.com/@me https://instagram.com/me Get it: https://walmrt.us/zz9') === 'https://walmrt.us/zz9')
check('no Walmart link means nothing changes', leadingWalmartLink('https://www.amazon.com/dp/B0ABCDEFGH') === null && leadingWalmartLink('') === null)

const strip = renderPriceStrip({ affiliateUrl: 'https://mvpl.ink/abcd', isAmazon: false, retailerLabel: 'Walmart', productName: 'Box Fan' })
check('the price strip names Walmart, never Amazon', /Get the best price on Walmart for Box Fan/.test(strip) && !/Amazon/.test(strip) && /Clicking takes you to Walmart/.test(strip))

const route = read('app/api/blog/generate/route.ts')
const gen = read('services/claude/index.ts')
check('the post route uses the Walmart link before any title ASIN', /if \(walmartLead\) \{\s*destination = walmartLead\s*\} else if \(titleAsin \|\| descAsin\)/.test(route))
check('the end button and the strip say Walmart', /retailerLabelOverride: retailerLabel/.test(route) && /const stripIsAmazon = !retailerLabel &&/.test(route) && /const ctaIsAmazon = !ctaRetailer &&/.test(gen) && /nicheScaffold, ctaRetailer\)/.test(gen))
check('a Geniuslink of a Walmart short link is not called the wrong product', /if \(walmart\(ih\) && walmart\(rh\)\) return true/.test(route))

if (failed) { console.error(`\n${failed} store link check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
