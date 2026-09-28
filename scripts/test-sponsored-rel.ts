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

// ── Blog fix 1: every short and redirect form is caught too ──
{
  const { isAffiliateHref: aff } = require('../lib/sponsored-rel') as typeof import('../lib/sponsored-rel')
  check('a.co, bit.ly, mvpl.ink and MVP /go/ links are affiliate links',
    aff('https://a.co/d/abc') && aff('https://bit.ly/x') && aff('https://mvpl.ink/Ab12Cd') && aff('https://www.mvpaffiliate.io/go/Ab12Cd') && aff('https://links.example.com/go/Ab12'))
  check('an ordinary link is left alone', !aff('https://example.com/review') && !aff('https://example.com/go/'))
}
{
  const { extractFaqFromHtml } = require('../lib/seo-schema') as typeof import('../lib/seo-schema')
  const { insertRelatedLinks } = require('../lib/internal-links') as typeof import('../lib/internal-links')
  const post = `<!-- wp:heading --><h2>Build</h2><!-- /wp:heading --><p>Solid.</p>
<!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->
<!-- wp:heading {"level":3} --><h3>Is it loud?</h3><!-- /wp:heading --><p>No, about 40 dB.</p>
<!-- wp:heading {"level":3} --><h3>Does it fold?</h3><!-- /wp:heading --><p>Yes, flat.</p>
<!-- wp:html --><div class="gr-scorecard">Overall 4.5</div><!-- /wp:html --><!-- wp:html --><div class="gr-cta-card">Check price</div><!-- /wp:html -->`
  const html = insertRelatedLinks(post, '<!-- wp:html --><aside><h2>Also worth considering</h2></aside><!-- /wp:html -->')
  const faq = extractFaqFromHtml(html)
  check('the related block goes before the FAQ, not inside it', html.indexOf('<aside>') < html.indexOf('Frequently Asked'))
  check('every FAQ question reaches the schema, and nothing after the FAQ leaks into an answer',
    faq.length === 2 && faq[1].answer === 'Yes, flat.')
  const PHP = read('wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php')
  check('the plugin prints no second FAQPage when MVP\'s graph has one, and cuts its own at the scorecard',
    /strpos\(\$graph, 'FAQPage'\) !== false\) return;/.test(PHP) && /<aside\\b\|<div\\b\/i', \$faq_chunk/.test(PHP))
  check('the schema dates are WordPress\'s own', /\['dateModified'\]  = get_the_modified_date\('c', \$post_id\)/.test(PHP))
  check('no duplicate description or OG tags beside an SEO plugin', /if \(!\$seo_plugin && \$desc !== ''\)/.test(PHP))
  const GEN = read('app/api/blog/generate/route.ts')
  check('a rebuild keeps the first publication date and says it was modified',
    /published_at: \(\(existingPost as \{ published_at\?: string \| null \} \| null\)\?\.published_at\) \|\| new Date\(\)\.toISOString\(\)/.test(GEN) && /existingPost \? \{ dateModified: new Date\(\)\.toISOString\(\) \}/.test(GEN))
  check('image alt text claims no use and has no dash', !/'in use'|'hands-on'/.test(GEN) && /`\$\{altBase\}, \$\{ALT_DESCRIPTORS/.test(GEN))
  check('Claude\'s search crawler is allowed', /'Claude-SearchBot'/.test(PHP) && /Claude-SearchBot/.test(read('lib/ai-crawlers.ts')))
}

if (failures.length) {
  console.error(`\n❌ sponsored-rel: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ sponsored-rel: every affiliate link in a published body carries rel="sponsored", whichever path built it')
