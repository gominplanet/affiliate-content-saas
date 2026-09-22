// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PUBLISHED POST'S THUMBNAIL CAN BE REBUILT ON ITS OWN.
//
// A creator reported a misspelled headline on a thumbnail and asked how to
// regenerate it. There was no way: the Art Director hero was sixty lines
// buried two thousand four hundred lines into /api/blog/generate, reachable
// only by rewriting the entire post. So fixing an image meant rewriting an
// article that was already fine, and spending a generation to do it.
//
// The fix is the same one this codebase keeps arriving at. The logic moves
// into a module, both callers use it, and every outcome gets a sentence
// instead of a console warning.
import { readFileSync } from 'node:fs'
import { heroOutcomeMessage, type HeroOutcome } from '../lib/blog-hero'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIB = live(read('lib/blog-hero.ts'))
const ROUTE = live(read('app/api/blog/posts/[id]/thumbnail/route.ts'))
const GEN = live(read('app/api/blog/generate/route.ts'))
const BTN = read('components/content/ArtDirectorThumbnailButton.tsx')
const PAGE = read('app/(dashboard)/content/page.tsx')

// ── one builder, two callers ────────────────────────────────────────────────
{
  check('the builder is a module',
    /export async function rebuildPostHero/.test(LIB),
    'sixty lines inside a route is reachable exactly one way')
  check('the rewrite path uses it',
    /await rebuildPostHero\(\{/.test(GEN),
    'leaving a copy behind is two paths that agree until one of them learns something')
  check('and so does the rebuild route',
    /await rebuildPostHero\(\{/.test(ROUTE))
  check('neither caller builds a hero itself any more',
    !/generateArtDirectorBlogHero/.test(GEN) && !/generateArtDirectorBlogHero/.test(ROUTE),
    'a second call to the generator is the copy this just removed')

  // THE CAP IS THE SAME ONE. A button that did not count against it would be a
  // way to spend without a limit just by pressing it.
  check('a rebuild counts against the thumbnail allowance',
    /checkUsageCap/.test(LIB) && /PRIMARY_FEATURE\.thumbnail/.test(LIB),
    'an uncapped button is a bill nobody agreed to')
}

// ── every outcome has a sentence, not a console warning ─────────────────────
{
  const reasons: HeroOutcome[] = [
    { ok: true, imageUrl: 'https://x/y.jpg', mediaId: 1 },
    { ok: false, reason: 'over_cap', message: '' },
    { ok: false, reason: 'no_product_image', message: '' },
    { ok: false, reason: 'generator_failed', message: '' },
    { ok: false, reason: 'upload_failed', message: '' },
    { ok: false, reason: 'error', message: 'boom' },
  ]
  const said = reasons.map(heroOutcomeMessage)
  check('every outcome says something', said.every((m) => m.length > 20), said.join(' | '))
  check('and they are not all the same sentence',
    new Set(said).size === said.length,
    'three console warnings that read identically from outside is what this replaces')
  // THE FAILURES SAY THE POST WAS NOT CHANGED, because the worry on pressing a
  // button that fails is whether it half-worked.
  for (const m of said.slice(1)) {
    check(`a failure says the post is untouched: "${m.slice(0, 32)}…"`,
      /keep|kept|still|nothing changed|try again/i.test(m))
  }
  check('the cap message names the cap rather than blaming the render',
    /thumbnails for this billing period/.test(heroOutcomeMessage({ ok: false, reason: 'over_cap', message: '' })),
    '"could not be designed" over a billing limit sends somebody debugging the wrong thing')
}

// ── the route only reports success when something changed ───────────────────
{
  check('a failed rebuild is not a 200',
    /if \(!outcome\.ok\) \{/.test(ROUTE) && /status: outcome\.reason === 'over_cap' \? 429 : 502/.test(ROUTE),
    'a success shape over an unreplaced thumbnail is the plan reported as the result')
  check('an unpublished post is refused with a reason',
    /not on WordPress yet/.test(ROUTE),
    'a generation that succeeds and lands nowhere is the most confusing possible outcome')
  // THE FALLBACK BRANCH, not the name of the flag. Pinning `isUuid` passed
  // over a version hardcoded to true, which is the numeric-id path deleted.
  check('both kinds of post id are accepted',
    /\.test\(id\)/.test(ROUTE)
    && /\.eq\('wordpress_post_id', Number\(id\)\)/.test(ROUTE)
    && /\.eq\('id', id\)/.test(ROUTE),
    'the two tabs carry different ids, and working on one of them is worse than neither')
  check('and a post MVP does not know is told so plainly',
    /no record of this post/.test(ROUTE))
}

// ── the button ──────────────────────────────────────────────────────────────
{
  check('the button says what the checkbox says',
    /Update my post thumbnail with Art Director/.test(BTN),
    'a second name for the same action looks like a second feature with its own rules')
  check('it warns that it is slow',
    /takes up to a minute/.test(BTN),
    'a silent button for a minute reads as a broken one and gets pressed again')
  check('it repeats the reason it was given',
    /data\?\.error/.test(BTN),
    'the route knows which of three things went wrong; a generic toast throws that away')
  check('and it is on the page, beside the upload one',
    /ArtDirectorThumbnailButton/.test(PAGE)
    && (PAGE.match(/<ArtDirectorThumbnailButton/g) ?? []).length >= 2,
    'a component nothing renders is a feature nobody has')
}

if (failures.length) {
  console.error(`\n❌ rebuild-thumbnail: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ rebuild-thumbnail: one builder, two callers, and a button that says which of three things went wrong')
