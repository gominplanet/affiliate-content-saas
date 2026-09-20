// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE THUMBNAIL SHOWS THE PRODUCT, AND SAYS SO WHEN IT CANNOT PROVE IT.
//
// A creator reported thumbnails "sometimes giving the wrong product". Three
// causes, all of them in this repo's own words.
//
//   1. lib/product-image exists precisely because Amazon's MAIN image is often
//      a multi-panel marketing collage: the product staged in a kitchen with a
//      cutting board and a charging cable. Its header says handing that to an
//      image model makes it "re-render a prop instead of the actual product".
//      The thumbnail route passed fastImage:true, which SKIPS that picker and
//      takes the hero image directly, to save three to eight seconds.
//
//   2. verifyProductMatch catches a similar-but-different render. The blog uses
//      it, Pinterest uses it, the hero image uses it. The thumbnail did not, so
//      the one image a creator looks hardest at was the only one shipping
//      unchecked.
//
//   3. When no reference resolves at all the model draws a plausible product
//      from the title, and nothing on screen told the difference.
//
// CHECKED, NOT RETRIED. A QC retry used to live in this route and was removed
// because re-running gpt-image added sixty to ninety seconds and pushed the
// request past the client's timeout, so the fix for a wrong product was a
// request that failed outright. The verdict goes on the screen instead.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ROUTE = live(read('app/api/youtube/generate-thumbnail/route.ts'))
const PAGE_RAW = read('app/(dashboard)/amazon/thumbnails/page.tsx')
const PICKER = read('lib/product-image.ts')

// ── the reference is picked, not grabbed ────────────────────────────────────
{
  check('the thumbnail does not skip the vision picker',
    /fastImage: false/.test(ROUTE) && !/fastImage: true/.test(ROUTE),
    "Amazon's hero image is often a collage, and a collage is what makes the model draw a cutting board")
  check('and the picker it must not skip still rejects collages',
    /multi-panel marketing collages/i.test(PICKER) && /Lifestyle scenes where the product is staged with props/i.test(PICKER),
    'the safeguard has to still be a safeguard for skipping it to matter')
  check('the picker costs nothing when there is no choice to make',
    /if \(imgs\.length <= 1\) return imgs\[0\]/.test(PICKER),
    'the speed argument for skipping it does not apply to a single-image listing')
}

// ── the output is checked against the reference ─────────────────────────────
{
  check('the thumbnail verifies the product it rendered',
    /await verifyProductMatch\(/.test(ROUTE),
    'every other generated-image surface does this; the thumbnail was the only one that did not')
  check('and the verdict reaches the response',
    /\bproductMatch,/.test(ROUTE) && /productMatchNote,/.test(ROUTE),
    'a check whose answer never leaves the server is not a check')
  check('a verifier that fell over is not recorded as a pass',
    /pv\.reason === 'verification-skipped'/.test(ROUTE),
    "verifyProductMatch returns match:true on its own failure, by design, so this route has to tell the two apart")
  check('the three states are distinguishable',
    /productChecked: productMatch !== null/.test(ROUTE),
    'matched, did not match and nobody looked are three answers, and a blank one reading as a pass is the bug')
}

// ── no reference at all is its own answer ───────────────────────────────────
{
  check('the route says whether it found a reference',
    /productRefFound: !!productImageUrl/.test(ROUTE),
    'with none, the model invents a product from the title and it looks identical on screen')
  check('and the screen says the product was invented',
    /invented from the title/.test(PAGE_RAW),
    'presenting an imagined product as the real one is the failure this whole check exists to stop')
}

// ── the screen shows all of it ──────────────────────────────────────────────
{
  check('a mismatch is named on the card',
    /This may not be your product/.test(PAGE_RAW))
  check('a pass is stated rather than implied by silence',
    /Product checked against the real photo/.test(PAGE_RAW))
  // THE PRODUCT'S LINE. The garment block says something almost identical, so
  // the bare phrase matched it and passed over a product verdict gone silent.
  check('and an unjudged render says nobody looked',
    /'The product could not be checked this time'/.test(PAGE_RAW)
    && /compare it against the photo yourself/.test(PAGE_RAW),
    'silence here reads as a pass, which is exactly how a wrong polo once shipped looking verified')
}

// ── it is not slower in the way that broke it before ────────────────────────
{
  check('no QC re-render was reintroduced',
    !/attempt\(\)[\s\S]{0,200}verifyProductMatch/.test(ROUTE),
    'the old retry added sixty to ninety seconds and pushed the request past the client timeout')
  check('the check runs once, on the finished image',
    (ROUTE.match(/await verifyProductMatch\(/g) ?? []).length === 1,
    'one Haiku call is the whole budget this is allowed to spend')
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const copy = (PAGE_RAW.match(/>[^<>{}]{25,}</g) ?? []).join('\n')
  check('there is copy to check', copy.length > 200, `${copy.length} chars`)
  check('no dash punctuation in the copy',
    !/[—–]/.test(copy), (copy.match(/.{0,40}[—–].{0,40}/) ?? [''])[0])
  check('no year stamped into the copy', !/\b20\d\d\b/.test(copy))
}

if (failures.length) {
  console.error(`\n❌ thumb-product: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ thumb-product: the reference is picked, the render is checked, and an unproven product says so')
