// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Two or more products make one image that compares them (Seb, 2026-10-12:
// "if user pastes 3 asins, the image should reflect those three products").

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readProductList, productFields, comparisonNote, firstProduct, MAX_COMPARE } from '../lib/product-list'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

check('three ASINs, comma separated, are three products', readProductList('B0D5H9M72G, b0abcdef12,B0XYZ12345').join(' ') === 'B0D5H9M72G B0ABCDEF12 B0XYZ12345')
check('ASINs on new lines and links mixed in are read in order', readProductList('B0D5H9M72G\nhttps://amzn.to/abc\nhttps://www.amazon.com/dp/B0ABCDEF12?tag=x').length === 3)
check('a link and its own ASIN pasted together are one product', readProductList('https://www.amazon.com/dp/B0D5H9M72G B0D5H9M72G').length === 1)
check(`at most ${MAX_COMPARE} products`, readProductList('B0AAAAAAA1 B0AAAAAAA2 B0AAAAAAA3 B0AAAAAAA4 B0AAAAAAA5').length === MAX_COMPARE)
check('words that are not products are ignored', readProductList('compare these B0D5H9M72G and B0ABCDEF12 please').length === 2)
const one = productFields('B0D5H9M72G')
check('one product is sent as before, with no comparison', one.asin === 'B0D5H9M72G' && !('comparisonAsins' in one))
const many = productFields('B0D5H9M72G, https://amzn.to/abc')
check('two or more are sent as a comparison, the first as the main product', many.asin === 'B0D5H9M72G' && Array.isArray(many.comparisonAsins) && (many.comparisonAsins as string[]).length === 2)
check('a single link is still a link', productFields('https://amzn.to/abc').productUrl === 'https://amzn.to/abc')
check('fewer products shown than pasted is said; all shown is not', /2 of your 3 products/.test(comparisonNote({ asked: 3, shown: 2 }) || '') && comparisonNote({ asked: 3, shown: 3 }) === null && comparisonNote(null) === null && /shows one product/.test(comparisonNote({ asked: 2, shown: 1 }) || ''))
check('the caption and the post link use the first product', firstProduct('B0D5H9M72G, B0ABCDEF12') === 'B0D5H9M72G')

const route = read('app/api/youtube/generate-thumbnail/route.ts')
check('the image route compares for every plan, ASINs and links alike', /const isComparison = cmpItems\.length >= 2/.test(route) && !/canUsePreview\('comparison'/.test(route) && /description: isAsin \? null : a/.test(route))
for (const f of ['app/(dashboard)/amazon/thumbnails/page.tsx', 'components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx', 'components/amazon/PostToAll.tsx']) {
  const src = read(f)
  check(`${f.split('/').pop()} sends every pasted product and says how many made it`, /productFields\(/.test(src) && /comparisonNote\(/.test(src))
}
const hero = read('lib/blog-hero.ts')
check('the post hero shows every product a comparison video covers', /generateArtDirectorRoundupHero\(/.test(hero) && /many\.length >= 2/.test(hero) && /asins: Array\.isArray\(video\?\.asins\)/.test(read('app/api/blog/posts/[id]/thumbnail/route.ts')))
check('the Idea List hero shows the top picks together', /generateArtDirectorRoundupHero\(/.test(read('app/api/idea-list/generate/route.ts')))

if (failed) { console.error(`\n${failed} product list check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
