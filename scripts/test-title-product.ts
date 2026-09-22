// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A THUMBNAIL TITLE IS ABOUT THE PRODUCT, NOT THE SHOP.
//
// "Write it for me" on a launch batch came back with AMAZON TEST, WORTH IT?,
// AMAZON PRODUCT REVIEW, AMAZON WIN? and BIG MISTAKE?. Five titles, and the
// only noun in any of them was a retailer.
//
// The prompt was not the problem. It already says the product noun must appear
// in most of the options. The problem was what it was given: an ASIN, which is
// ten characters that name nothing, and a placeholder video title reading
// "Amazon product B0H3P7H9T2". The only word in the whole prompt that looked
// like a subject was "Amazon", so that is what it wrote about.
//
// You cannot ask a writer to name a thing you never told it the name of.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIB = live(read('lib/title-options.ts'))
const LIB_RAW = read('lib/title-options.ts')
const ROUTE = live(read('app/api/launch/items/[id]/title/route.ts'))

// ── the writer is told what the product actually is ─────────────────────────
{
  check('the product name can be passed in',
    /productTitle\?: string \| null/.test(LIB_RAW),
    'an ASIN is ten characters that name nothing')
  check('and is looked up when it was not',
    /await fetchAmazonProduct\(asin\)/.test(LIB),
    'a caller should not have to know to make that call to get a usable title')
  check('the lookup never breaks the writer',
    /catch \{ \/\* the ASIN alone still beats nothing \*\//.test(LIB_RAW),
    'failing to name the product is worse titles, not no titles')
  check('and the name reaches the prompt as the subject',
    /THE PRODUCT \(this is the subject/.test(LIB),
    'a field fetched and never used is a call spent for nothing')
}

// ── the retailer is never the subject ───────────────────────────────────────
{
  check('naming the shop is called out as a failure',
    /NEVER make the retailer the subject/.test(LIB)
    && /AMAZON TEST/.test(LIB) && /AMAZON WIN/.test(LIB),
    'the exact five titles that came back are the examples worth banning')
  check('and a placeholder video title is to be ignored',
    /If the VIDEO TITLE is a placeholder/.test(LIB),
    'the placeholder was the only subject in the prompt, so it won')
}

// ── the route stops inventing a subject ─────────────────────────────────────
{
  check('no fake video title is sent',
    !/Amazon product \$\{asin\}/.test(ROUTE),
    'that string IS where "AMAZON TEST" came from')
  check('an empty one is passed honestly instead',
    /videoTitle: useful,/.test(ROUTE),
    'empty tells the writer to work from the product; a placeholder tells it to work from a shop')
  check('and an ASIN typed in the title box is still not fed back',
    /hint\.toUpperCase\(\) !== asin\.toUpperCase\(\)/.test(ROUTE),
    'the other way the subject becomes noise')
}

if (failures.length) {
  console.error(`\n❌ title-product: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ title-product: the writer is told the product’s real name, and never writes about the shop it is sold in')
