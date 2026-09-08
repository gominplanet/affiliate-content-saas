// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A post about several products does not get fronted by one of them.
//
// A Deal Radar roundup covering four products went to the site wearing a single
// bare Amazon photograph of a beverage fridge. The route chose that on purpose.
// Its comment read "a roundup spans multiple products, so use the lead deal's
// product image (the AI thumbnail pipeline is single-product)", which was
// accurate at the time: the designed hero took one product, and the
// multi-product designer next to it only made vertical Pinterest pins. Nobody
// had written the third case.
//
// The creator's verdict was to paste the post URL into ChatGPT, get a better
// header back in one shot, and ask why the product could not do that.
//
// So the rule this file holds is narrow and worth stating plainly: a route that
// publishes a post about N products must hand all N to the hero designer, and
// must not hand-roll its own featured-image upload, because hand-rolling is how
// the two roundup routes ended up with the same bug written twice.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const HELPER = read('lib/post-hero.ts')
const ART = read('lib/art-director-pin.ts')

// ── the multi-product designer exists and knows what kind of post it is ─────
{
  check('there is a landscape multi-product hero',
    /export async function generateArtDirectorRoundupHero/.test(ART),
    'this is the case whose absence caused the bug')
  check('it takes several products', /products: Array<\{ imageUrl: string; title: string \}>/.test(ART))
  check('it refuses to design a roundup of one', /items\.length < 2\) return null/.test(ART),
    'one product is a review and belongs to the single-product hero')
  check('it knows a deal from a guide', /kind\?: 'deal' \| 'guide'/.test(ART))
  check('a deals header does not invent a discount', /NO INVENTED NUMBERS/.test(ART),
    'the designer is told product titles, never prices')
  check('and never draws people', /ABSOLUTELY NO PEOPLE/.test(ART))
}

// ── the helper picks by shape, not by route ─────────────────────────────────
{
  check('two or more products take the roundup designer',
    /usable\.length >= 2[\s\S]{0,120}generateArtDirectorRoundupHero/.test(HELPER))
  check('one product takes the single-product hero',
    /generateArtDirectorBlogHero/.test(HELPER))
}

// ── a paid render obeys the same gates as every other paid render ───────────
{
  check('the monthly spend ceiling is checked', /spendGate\(/.test(HELPER),
    'this is a gpt-image render on every published post; it cannot sit outside the ceiling')
  check('the per-tier image allowance is checked', /checkUsageCap\(/.test(HELPER))
  check('and it shares the thumbnail counter rather than inventing one',
    /PRIMARY_FEATURE\.thumbnail/.test(HELPER))
}

// ── it can never make a post worse than it was ─────────────────────────────
{
  check('there is a fallback to the raw product photo', /useFallback/.test(HELPER))
  check('every skip path uses it',
    (HELPER.match(/return useFallback\(/g) || []).length >= 4,
    'over cap, over ceiling, render failed, upload failed')
  check('it never throws', /catch \(e\)[\s\S]{0,200}useFallback/.test(HELPER),
    'a hero is worth trying for and never worth failing a publish over')
}

// ── and it says which of those happened ────────────────────────────────────
// The whole point. A media id from a designed render and a media id from a
// stock photo look identical to the caller, which is how this feature could be
// switched on everywhere and quietly keep producing stock photos.
{
  check('the outcome distinguishes designed from fallback',
    /'designed' \| 'product-photo' \| 'none'/.test(HELPER))
  check('and carries a reason when it is not designed', /note: string \| null/.test(HELPER))
}

// ── the roundup routes actually use it ─────────────────────────────────────
{
  for (const [rel, label] of [
    ['app/api/deal-radar/roundup/route.ts', 'the Amazon deals roundup'],
    ['app/api/walmart/roundup/route.ts', 'the Walmart roundup'],
  ] as const) {
    const src = read(rel)
    check(`${label} uses the shared hero`, /attachPostHero\(/.test(src))
    check(`${label} passes every product, not just the first`,
      /products: \w+\.map\(/.test(src),
      'passing one product to a roundup is the original bug')
    check(`${label} no longer hand-rolls its own featured image`,
      !/uploadImageFromUrl\(hero/.test(src) && !/featuredMediaId/.test(src),
      'two routes hand-rolling the same upload is how the same bug got written twice')
    check(`${label} logs when it could not design one`,
      /hero\.note/.test(src),
      'a silent fallback is indistinguishable from success')
  }
}

// ── the single-product path prefers the real product ───────────────────────
// from-link generated its hero with a text-to-image model from a written
// prompt: on-topic, and containing no trace of the actual product. That is now
// the second choice, behind the designer that works from the real photograph.
{
  const src = read('app/api/blog/from-link/route.ts')
  check('from-link tries the reference-based hero first', /attachPostHero\(/.test(src))
  check('and only falls back to the text-to-image scene',
    /!featuredMedia && process\.env\.FAL_KEY/.test(src),
    'a generated scene never contains the product the post is about')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
