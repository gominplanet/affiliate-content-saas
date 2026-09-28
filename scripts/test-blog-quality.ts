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

// ── Fix 4: a quality gate before anything goes live ──
{
  const G = read('app/api/blog/generate/route.ts')
  const factAt = G.indexOf('FACT-CHECK BEFORE PUBLISHING, NOT AFTER')
  const publishAt = G.indexOf('── 8. Publish text post to WordPress')
  check('the fact-check runs before the post is published', factAt > 0 && factAt < publishAt && /factCheckedPrePublish = true/.test(G))
  check('the after() fact-check only runs when the one before publishing did not', /if \(!factCheckedPrePublish\) try \{\s*const checked = await claude\.factCheckAndGuard/.test(G))
  check('the gate counts tells before the post is sent', G.indexOf('const tells = findAiTells(content)') > 0 && G.indexOf('const tells = findAiTells(content)') < publishAt)
  check('only auto-pilot posts are held, and a held post goes to WordPress as a draft',
    /if \(body\.autopilot === true\)/.test(G) && /if \(heldForReview\) wpStatus = 'draft'/.test(G))
  check('a retry of the same job keeps the draft a draft', /existingIsThisJobsPost = true/.test(G) && /status: heldForReview \? 'draft' : 'publish'/.test(G))
  check('a held draft is not pinged to IndexNow', /if \(!isScheduled && !heldForReview\)/.test(G))
  check('a held draft carries no schedule the draft-flip cron could publish', /isScheduled && scheduledForIso && !heldForReview/.test(G))
  check('the hold and its reasons are recorded even when scoring fails', /\.\.\.\(aio \?\? \{\}\), tells:/.test(G) && /held: \{ at: new Date\(\)\.toISOString\(\), reasons: heldReasons \}/.test(G))
  check('the response says it was held', /held: heldForReview \? \{ reasons: heldReasons \} : null/.test(G))
  check('auto-pilot marks its jobs', /autopilot: true/.test(read('app/api/cron/auto-blog/route.ts')))
  check('nothing is shared to socials from a held post', /if \(result\?\.held\) \{ report\.skipped = 'held-for-review'; return report \}/.test(read('lib/generation-job-runner.ts')))
  check('publishing a held post clears the hold', /const \{ held, \.\.\.rest \} = post\.aio/.test(read('app/api/blog/publish-now/route.ts')))
  check('the Content page lists held posts', /<HeldPosts \/>/.test(read('app/(dashboard)/content/page.tsx')) && /\/api\/blog\/held/.test(read('components/content/HeldPosts.tsx')))

  const { findAiTells } = require('../lib/ai-tells') as typeof import('../lib/ai-tells')
  const kinds = (h: string) => findAiTells(h).map((t) => t.kind)
  const bad = kinds('<p>Let us delve into it. It serves as a hub. Not just fast, but also quiet. One word—another—more.</p>')
  check('the documented tells are found', ['word: delve', '"serves as"', '"not just X, but Y"', 'em dashes'].every((k) => bad.includes(k)), bad.join(', '))
  check('a plain first-hand paragraph has none', kinds('<p>I plugged it in on Tuesday. It worked, and the fan is loud.</p>').length === 0)
  check('Amazon title dashes and number ranges are not counted', !kinds('<p>Anker Charger – 65W. Ships in 5–10 days. Anker Charger – 65W again.</p>').includes('em dashes'))
  const level = Array.from({ length: 30 }, () => 'This sentence has exactly seven words here.').join(' ')
  check('uniform sentence length is caught on long posts', kinds(`<p>${level}</p>`).includes('uniform sentence length'))
}

if (failures.length) {
  console.error(`\n❌ blog-quality: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-quality: one consistent set of instructions, the answer first, and no experience nobody had')
