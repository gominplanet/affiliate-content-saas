/**
 * CLIP FACTORY FILLS IN THE PRODUCT (Alejandro, 2026-10-05).
 *
 * A clip that did not come from a scripted video used to need the ASIN and the
 * product name typed every time. MVP now fills them from what it already knows
 * (the file name, the picked Short, the name it wrote down for that ASIN), says
 * where the guess came from, never types over the creator, and offers their
 * recent products as one-tap picks.
 *
 * Run: npx tsx scripts/test-clip-product-guess.ts
 */
import { readFileSync } from 'node:fs'
import { nameFromFileName, asinInText, asinInFileName } from '../lib/clip-product-guess'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

check('an ASIN in the file name is found', asinInFileName('Ninja Crispi - B0DDDD8WD6.mp4') === 'B0DDDD8WD6')
check('the product name comes from the file name, without the ASIN or extension', nameFromFileName('Ninja Crispi - B0DDDD8WD6.mp4') === 'Ninja Crispi')
check('a camera-roll name is not a product name', nameFromFileName('IMG_4821.MOV') === null)
check('an ASIN in a description link is found', asinInText('Get it here https://www.amazon.com/dp/B0ABC12345?tag=x-20 thanks') === 'B0ABC12345')

const R = read('app/api/clip-factory/product-guess/route.ts')
check('the guess says where it came from', /from: 'file' \| 'video' \| 'typed' \| null/.test(R) && /\{ product, productName, from, recent \}/.test(R))
check('the source video is found by its row id or its YouTube id', /\? 'id' : 'youtube_video_id'/.test(R))
const C = read('components/clip-factory/ClipFactory.tsx')
check('never types over what the creator entered', /if \(d\?\.product && !productRef\.current\.trim\(\)\)/.test(C) && /if \(d\?\.productName && !productNameRef\.current\.trim\(\)\)/.test(C))
check('the screen says the product was filled in for them', /Filled in from \{productGuessFrom === 'file' \? 'the file name'/.test(C))
check('recent products are one-tap picks', /Or pick one of your recent products/.test(C))
check('a typed ASIN fills its product name', /product-guess\?asin=\$\{asin\}/.test(C))

if (failures.length) {
  console.error('❌ clip-product-guess guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ clip-product-guess guard passed (the product fills itself in, says how, and never overwrites the creator)')
