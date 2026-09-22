// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY AFFILIATE LINK IN A PUBLISHED POST CARRIES rel="sponsored".
//
// Asked whether the claim "the links are tagged as sponsored in the page code"
// was true. It was true of every link MVP CONSTRUCTS, which is a claim about
// the code paths we know about, and a post body is assembled from several of
// them plus prose written by a model. "Every link we build is tagged" and
// "every link in the published post is tagged" are different statements, and
// only the second is what anybody means by it.
//
// So the finished HTML is swept once before publish, and this pins the sweep.
import { readFileSync } from 'node:fs'
import { ensureSponsoredRel, untaggedAffiliateLinks, isAffiliateHref } from '../lib/sponsored-rel'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const GEN = live(read('app/api/blog/generate/route.ts'))

// ── what counts as a link that earns ────────────────────────────────────────
{
  for (const href of [
    'https://www.amazon.com/dp/B0TEST',
    'https://amazon.co.uk/dp/B0TEST',
    'https://amzn.to/xyz',
    'https://geni.us/abc',
    'https://shop.example.com/x?tag=mvp-20',
  ]) {
    check(`counts as affiliate: ${href}`, isAffiliateHref(href))
  }
  for (const href of [
    'https://gominreviews.com/some-post/',
    'https://youtube.com/watch?v=abc',
    '/relative/path',
    'mailto:x@y.com',
    'javascript:alert(1)',
  ]) {
    check(`left alone: ${href}`, !isAffiliateHref(href),
      'a sweep that edits more than it was asked to is one nobody trusts near a published post')
  }
}

// ── the sweep ───────────────────────────────────────────────────────────────
{
  const bare = '<p>Try <a href="https://www.amazon.com/dp/B0X" target="_blank">this</a>.</p>'
  const out = ensureSponsoredRel(bare)
  check('a bare affiliate anchor gets the tokens',
    /rel="[^"]*sponsored[^"]*"/.test(out) && /nofollow/.test(out) && /noopener/.test(out), out)
  check('and the href is untouched',
    out.includes('href="https://www.amazon.com/dp/B0X"'), out)

  // NEVER REMOVES WHAT SOMEBODY ALREADY PUT THERE.
  const partial = '<a href="https://amzn.to/x" rel="noreferrer">go</a>'
  const kept = ensureSponsoredRel(partial)
  check('an existing token survives',
    /noreferrer/.test(kept) && /sponsored/.test(kept), kept)

  // ALREADY CORRECT LINKS ARE NOT DOUBLED.
  const good = '<a href="https://amzn.to/x" rel="nofollow sponsored noopener">go</a>'
  const twice = ensureSponsoredRel(ensureSponsoredRel(good))
  check('running it twice changes nothing',
    (twice.match(/sponsored/g) ?? []).length === 1, twice)

  // A NON-AFFILIATE LINK IS NOT TOUCHED AT ALL.
  const internal = '<a href="https://gominreviews.com/post/">read</a>'
  check('an internal link is left exactly as it was',
    ensureSponsoredRel(internal) === internal,
    'nofollowing your own internal links would be an SEO own goal')

  check('the counter reports what is still untagged',
    untaggedAffiliateLinks(bare) === 1 && untaggedAffiliateLinks(out) === 0,
    'a sweep that cannot report is one nobody can verify ran')
}

// ── it actually runs before publish ─────────────────────────────────────────
{
  check('the blog route sweeps the final body',
    /content = ensureSponsoredRel\(content\)/.test(GEN),
    'a sweep nothing calls makes the claim false while looking true')
  // BEFORE THE PUBLISH, not after. A tag added to a post already live is a
  // window in which the claim was untrue.
  check('and does it before the post is created',
    GEN.indexOf('ensureSponsoredRel(content)') < GEN.indexOf('wpService.createPost'),
    'tagging after publish leaves a live post untagged in between')
  check('and says so when it had to fix something',
    /without rel="sponsored"/.test(read('app/api/blog/generate/route.ts')),
    'a silent repair hides the path that produced an untagged link')
}

if (failures.length) {
  console.error(`\n❌ sponsored-rel: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sponsored-rel: every affiliate link in a published body carries rel="sponsored", whichever path built it')
