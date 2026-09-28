// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The blog quality fixes (research, September): posts Google and AI answer
// engines treat as helpful, and that never claim experience nobody had.
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

// ── Fix 2: one set of instructions, and the answer first ──
{
  const W = read('services/claude/index.ts')
  check('length obeys the ceiling and the source, with no "keep going to the top"',
    !/keep going to the top of it/.test(W) && /the HARD CEILING and the source\s+material always win/.test(W))
  check('no FAQ minimum left to contradict the computed count', !/7-10 question minimum/.test(W))
  check('no prices in the good examples of a prompt that bans prices', !/again at \$80|\$82 buys|best \$80 grinder/.test(W))
  check('no reference to a section that no longer exists', !/Section [CD]\b/.test(W))
  check('with no first-hand source, the experience block beats "first person always"',
    /WHEN THE EXPERIENCE BLOCK SAYS THERE IS NO FIRST-HAND SOURCE, THAT BLOCK WINS/.test(W))
  check('the post opens with a 40 to 60 word direct answer, before the disclaimer, naming the exact product, with no link or price',
    /\[0\] THE DIRECT ANSWER/.test(W) && W.indexOf('[0] THE DIRECT ANSWER') < W.indexOf('[1] AFFILIATE DISCLAIMER BLOCK')
    && /40 to 60\s+words/.test(W) && /No link in it, no price/.test(W) && /class="mvp-answer"/.test(W))
}

// ── Fix 3: no identical scaffolding, and every post says how it was made ──
{
  const { withProvenanceNote, stripHashtagBlock, provenanceText, comparisonProvenanceText } = require('../lib/post-provenance') as typeof import('../lib/post-provenance')
  const post = `<!-- wp:paragraph {"className":"mvp-answer"} --><p class="mvp-answer">Answer.</p><!-- /wp:paragraph -->
<!-- wp:group {"style":{"color":{"background":"#fffbe6"}}} --><div>Disclosure</div><!-- /wp:group -->
<p>Body</p><div class="gr-tags"><span>#a</span><span>#b</span></div><p>End</p>`
  const out = withProvenanceNote(stripHashtagBlock(post), 'none', 'Seb')
  check('the provenance line sits right after the disclosure', out.indexOf('mvp-provenance') > out.indexOf('Disclosure') && out.indexOf('mvp-provenance') < out.indexOf('Body'))
  check('it is added once', withProvenanceNote(out, 'none').split('mvp-provenance').length === out.split('mvp-provenance').length)
  check('the hashtag block is gone and nothing else is', !/gr-tags/.test(out) && /<p>End<\/p>/.test(out))
  check('a research post says it was not tested; a video post says it happened on camera',
    /We have not tested this product ourselves/.test(provenanceText('none')) && /happened on camera/.test(provenanceText('video', 'Seb')) && /Seb's own video/.test(provenanceText('video', 'Seb')))
  check('a comparison says how many products come from the creator\'s own videos', /2 of the 3 products/.test(comparisonProvenanceText(2, 3, 'Seb')))
  const W = read('services/claude/index.ts')
  check('the writer is told not to write hashtags', /\[8\] NO HASHTAG BLOCK/.test(W) && !/10 hashtags researched/.test(W))
  const T = read('lib/clickable-titles.ts')
  const blogRule = T.slice(T.indexOf('export function clickableTitleRulesForBlog'), T.indexOf('export function clickableTitleRulesForComparison'))
  check('titles come from this post\'s own finding, never a stock framing or an unearned "Tested"',
    /THIS post's own deciding finding/.test(blogRule) && /Never "Tested:"/.test(blogRule) && !/"Tested: why it might be the best/.test(blogRule))
  for (const f of ['app/api/blog/generate/route.ts', 'app/api/blog/from-link/route.ts', 'app/api/blog/comparison/route.ts']) {
    check(`${f} says how the post was made and drops hashtags`, /withProvenanceNote\(/.test(read(f)) && /stripHashtagBlock\(/.test(read(f)))
  }
  const PHP = read('wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php')
  check('the How we test page no longer claims every review was hands-on',
    !/If you're reading a review here, we've held the product or used it/.test(PHP) && /Every review says at the top how it was made/.test(PHP))
}

if (failures.length) {
  console.error(`\n❌ blog-quality: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-quality: one consistent set of instructions, the answer first, and no experience nobody had')
