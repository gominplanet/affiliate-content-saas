// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reading an ASIN out of an Amazon URL, including the shapes Amazon actually
// serves rather than the ones we expected.
//
// Fix Affiliate Links refused to re-point a real post three times running,
// reporting "could not work out which product this post is about". The post's
// buy button was https://geni.us/KizWAf, which resolves perfectly. Following it
// server-side lands on /dp/B0DPKGY6LJ?tag=…, and Amazon then redirects THAT
// request onward to https://www.amazon.com/clp/B0DPKGY6LJ. Same product, same
// id, a path the parser did not know, so it returned null and the tool
// concluded the post was unidentifiable while holding a URL with the ASIN in it.
//
// The list of ASIN-bearing paths is Amazon's to change, so the fallback matters
// more than the missing entry: an amazon host with a B0-prefixed segment in its
// path is a product, whatever the surrounding path is called.
import { asinFromAmazonUrl, normalizeAsinInput } from '../lib/asin'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const cases: [string, string | null][] = [
  // The one that cost three failed runs. Verified live against geni.us/KizWAf.
  ['https://www.amazon.com/clp/B0DPKGY6LJ', 'B0DPKGY6LJ'],
  // The shape it came from, and the ordinary ones.
  ['https://www.amazon.com/dp/B0DPKGY6LJ?tag=gomin0e-20&ascsubtag=HJ3Fqz9DUes&th=1&psc=1&geniuslink=true', 'B0DPKGY6LJ'],
  ['https://www.amazon.com/dp/B0H986NKLH', 'B0H986NKLH'],
  ['https://www.amazon.com/gp/product/B0H986NKLH', 'B0H986NKLH'],
  ['https://www.amazon.com/gp/aw/d/B0H986NKLH', 'B0H986NKLH'],
  ['https://www.amazon.co.uk/Some-Product-Name/dp/B0H986NKLH/ref=sr_1_1', 'B0H986NKLH'],
  // The fallback: an unknown ASIN-bearing path on an Amazon host.
  ['https://www.amazon.com/some-future-path/B0DPKGY6LJ', 'B0DPKGY6LJ'],
  ['https://www.amazon.co.jp/whatever/B0DPKGY6LJ/x', 'B0DPKGY6LJ'],
  // NOT products. A search link is the one that started the whole hunt: a real
  // Amazon URL, with the creator's tag on it, that identifies nothing.
  ['https://www.amazon.com/s?k=Solar%20Dog%20Statue&tag=gomin0e-20', null],
  ['https://www.amazon.com/stores/page/ABC123', null],
  ['https://www.amazon.com/', null],
  // The fallback must not fire off-Amazon, or any site with a 10-character path
  // segment becomes a product.
  ['https://example.com/B0DPKGY6LJ', null],
  ['https://notamazon.com/dp/B0DPKGY6LJ', 'B0DPKGY6LJ'], // explicit /dp/ is still honoured by the primary pattern
  ['', null],
]

for (const [url, want] of cases) {
  check(`asinFromAmazonUrl(${url || '""'})`, asinFromAmazonUrl(url) === want,
    `expected ${want}, got ${asinFromAmazonUrl(url)}`)
}

// The paste-a-link-or-an-ASIN field rides on the same parser.
check('a bare ASIN normalizes', normalizeAsinInput('B0DPKGY6LJ') === 'B0DPKGY6LJ')
check('a clp link normalizes', normalizeAsinInput('https://www.amazon.com/clp/B0DPKGY6LJ') === 'B0DPKGY6LJ')
check('a search link does not', normalizeAsinInput('https://www.amazon.com/s?k=thing') === null)

console.log(failures.length ? `FAIL (${failures.length})` : `ALL PASS (${cases.length} URL shapes)`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
