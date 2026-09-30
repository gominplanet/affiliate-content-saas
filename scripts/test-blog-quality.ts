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
  check('a research post says it was not tested; a video post says it is the creator\'s own review, in the first person, with no name',
    /We have not tested this product ourselves/.test(provenanceText('none')) && /my own video review/.test(provenanceText('video', 'Seb')) && !/Seb/.test(provenanceText('video', 'Seb')))
  // A post from the creator's own video whose words could not be read is
  // still theirs: a creator read "We have not tested this product ourselves"
  // under her own embedded video on every post.
  check('a post from the creator\'s own video never says it was not tested, even without a transcript',
    !/not tested/i.test(provenanceText('own-video', 'Seb')) && /my own video review/.test(provenanceText('own-video', 'Seb'))
    && /fromOwnVideo: true/.test(read('services/claude/index.ts')))
  {
    // AND THE POSTS ALREADY LIVE are corrected (lib/provenance-fix): the wrong
    // line becomes the own-video line, duplicates go, nothing else changes.
    const { fixProvenanceHtml } = require('../lib/provenance-fix') as typeof import('../lib/provenance-fix')
    const vid = '<!-- wp:html -->\n<div class="gr-video-wrap"><div class="gr-video-label">Watch</div><div class="gr-video-container"><iframe src="x"></iframe></div>\n</div>\n<!-- /wp:html -->'
    const bad = `${withProvenanceNote('<p>Body</p>', 'none', 'Seb')}\n${vid}\n<p>End</p>`
    const twice = `${withProvenanceNote('<p>Top</p>', 'none', 'Seb')}\n${bad}`
    const fixed = fixProvenanceHtml(twice, 'Seb')
    check('a live post from the creator\'s video loses the "not tested" line and its duplicates, and keeps the rest',
      !!fixed && !/not tested/i.test(fixed.html) && fixed.removedCopies === 1 && /<p>Body<\/p>/.test(fixed.html) && /<p>End<\/p>/.test(fixed.html) && fixed.html.includes('my own video review') && !fixed.html.includes('Seb'))
    check('the corrected line sits under the video, once',
      !!fixed && fixed.html.indexOf('mvp-provenance') > fixed.html.indexOf('</iframe>') && (fixed.html.match(/class="mvp-provenance"/g) ?? []).length === 1)
    check('a post that is already right is left alone', !!fixed && fixProvenanceHtml(fixed.html, 'Seb') === null)
    const named = `<p>A</p>\n${vid}\n<p class="mvp-provenance" style="font-size:13px;color:#6b6b70">How this review was made: from Caleb&#8217;s own video of the product, with the details from the listing and the maker&#8217;s specifications.</p>`
    {
      const { scrubDisclosureTestingClaims } = require('../lib/post-provenance') as typeof import('../lib/post-provenance')
      const box = '<!-- wp:group {"style":{"color":{"background":"#fffbe6"}}} --><div><p>Affiliate links here. How this page was made: researched from the listing. We have not tested this product ourselves.</p></div><!-- /wp:group --><p>We have not tested this product ourselves.</p>'
      const out = scrubDisclosureTestingClaims(box)
      check('on a video review the creator\'s disclosure loses its "not tested" sentences and keeps the rest; nothing outside the box changes',
        /Affiliate links here\./.test(out) && !/How this page was made/.test(out) && (out.match(/not tested/g) ?? []).length === 1
        && /if \(src === 'video' \|\| src === 'own-video'\) content = scrubDisclosureTestingClaims\(content\)/.test(read('app/api/blog/generate/route.ts')))
    }
    check('a line that names the creator is rewritten in the first person',
      !!fixProvenanceHtml(named, 'Caleb') && !/Caleb/.test(fixProvenanceHtml(named, 'Caleb')!.html) && /my own video review/.test(fixProvenanceHtml(named, 'Caleb')!.html))
    check('a new review from a video gets the line under the video; a research post keeps it at the top',
      withProvenanceNote(`<p>A</p>\n${vid}`, 'own-video', 'Seb').indexOf('mvp-provenance') > withProvenanceNote(`<p>A</p>\n${vid}`, 'own-video', 'Seb').indexOf('</iframe>')
      && withProvenanceNote(`<p>A</p>\n${vid}`, 'none', 'Seb').indexOf('mvp-provenance') < withProvenanceNote(`<p>A</p>\n${vid}`, 'none', 'Seb').indexOf('</iframe>'))
    check('the correction runs on its own until none are left',
      /await fixProvenanceLines\(admin\)/.test(read('app/api/cron/reconcile-stuck-images/route.ts'))
      && /\.not\('video_id', 'is', null\)/.test(read('lib/provenance-fix.ts')) && /checkSamePost\(wp,/.test(read('lib/provenance-fix.ts')))
  }
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

// ── Fix 5: posts kept current by the creator, never by a reworded date bump ──
{
  const R = require('../lib/post-refresh') as typeof import('../lib/post-refresh')
  const pub = new Date('2026-01-01T00:00:00Z')
  check('the update is labelled by elapsed time, never a calendar year',
    R.sinceLabel(pub, new Date('2026-04-02T00:00:00Z')) === '3 months in' && R.sinceLabel(pub, new Date('2027-01-01T00:00:00Z')) === '1 year in'
    && R.sinceLabel(pub, new Date('2029-02-01T00:00:00Z')) === '3 years in' && !/\b20\d\d\b/.test(R.updateBlock('x', R.sinceLabel(pub))))
  check('the note goes in as plain text', R.cleanRefreshNote('<b>Still</b> <script>x</script>  great') === 'Still x great' && /&lt;/.test(R.updateBlock('a < b', '3 months in')))
  const post = `<!-- wp:group {"style":{"color":{"background":"#fffbe6"}}} --><div>Disclosure</div><!-- /wp:group -->
<!-- wp:paragraph {"className":"mvp-provenance"} --><p class="mvp-provenance">How made</p><!-- /wp:paragraph -->
<p>Body <a href="https://amzn.to/abc">buy</a></p><div class="gr-tags"><span>#a</span></div>`
  const once = R.refreshedBody(post, 'First line here', '3 months in')
  const twice = R.refreshedBody(once, 'Second line here', '6 months in')
  check('the update sits after the provenance line, newest first, and earlier ones stay',
    once.indexOf('mvp-update') > once.indexOf('How made') && once.indexOf('mvp-update') < once.indexOf('Body')
    && twice.indexOf('Second line') < twice.indexOf('First line') && twice.split('class="mvp-update"').length === 3)
  check('the same save tags affiliate links and drops the hashtag block', /rel="[^"]*sponsored/.test(once) && !/gr-tags/.test(once))
  const aside = '\n<!-- wp:html -->\n<aside class="gr-also-consider" aria-label="x"><h2>Old</h2></aside>\n<!-- /wp:html -->\n'
  const swapped = R.withFreshRelated(`<p>a</p>${aside}<p>b</p>`, aside.replace('Old', 'New'), (h, b) => h + b)
  check('related posts are swapped, not stacked', /New/.test(swapped) && !/Old/.test(swapped) && swapped.split('gr-also-consider').length === 2)
  check('with nothing to link to, the related block is left alone', R.withFreshRelated(`<p>a</p>${aside}`, '', (h, b) => h + b).includes('Old'))

  const A = read('app/api/blog/refresh/route.ts')
  check('the update is built on the raw blocks WordPress has now, never the rendered page', /const read = await wp\.readRawPost/.test(A) && /refreshedBody\(live\.content/.test(A) && !/getPostContent/.test(A))
  check('the update is confirmed in what WordPress returns before it is reported', /const after = await wp\.readRawPost/.test(A) && /if \(!landed\)/.test(A))
  check('the post is read from the site its own address is on, and confirmed as the same post', /credsForPost\(admin, g\.ownerId, post\)/.test(A) && /checkSamePost\(wp, post\.wordpress_post_id, post\.wordpress_url\)/.test(A))
  check('a failed read says what WordPress answered', /is not on \$\{where\}/.test(A) && /would not let MVP open this post for editing/.test(A))
  const W = read('services/wordpress/index.ts')
  const rawRead = W.slice(W.indexOf('async readRawPost'), W.indexOf('async getPostMetaValue'))
  check('the raw read never falls back to the rendered page', /context=edit/.test(rawRead) && !/context=view/.test(rawRead) && /nonceOnReadRefusal: true/.test(rawRead))
  check('a one-word note is refused', /note\.length < 15/.test(A))
  check('only reviews and comparisons are asked, and only after the wait', /REFRESH_TYPES = \['review', 'comparison'\]/.test(A) && /lte\('published_at', cutoff\)/.test(A))
  check('a missing migration is said, not shown as nothing due', /needsMigration: 384/.test(A))
  check('it is Labs while tested', /canUsePreview\('post_refresh'/.test(A) && /post_refresh: 'labs'/.test(read('lib/labs-preview.ts')))
  check('the Content page shows it', /<PostUpdates \/>/.test(read('app/(dashboard)/content/page.tsx')))
}

// ── Fix 6: results measured, and scores that do not pass by default ──
{
  const G = read('app/api/blog/generate/route.ts')
  check('no AIO check is passed by a hardcoded true about product schema', /hasProductSchema: !!\(effectiveAsin \|\| productUrl\)/.test(G) && !/hasProductSchema: true/.test(G))
  const S = require('../lib/aio-score') as typeof import('../lib/aio-score')
  const base = S.scoreAio({ html: '<p>x</p>', hasFreshness: true })
  const now = new Date('2026-09-28T00:00:00Z')
  const old = S.withFreshnessNow(base, '2025-01-01T00:00:00Z', now)
  const fresh = S.withFreshnessNow(base, '2026-08-01T00:00:00Z', now)
  check('freshness expires when the post is read, and an update restores it',
    old.checks.find((c) => c.key === 'freshness')?.pass === false && fresh.checks.find((c) => c.key === 'freshness')?.pass === true && old.score < fresh.score)
  check('a post with no date is not fresh', S.withFreshnessNow(base, null, now).checks.find((c) => c.key === 'freshness')?.pass === false)
  check('the AIO summary judges freshness today, from the later of publish and update',
    /withFreshnessNow\(r\.aio, last\)/.test(read('app/api/seo/aio-summary/route.ts')) && /\[r\.published_at, r\.refreshed_at\]/.test(read('app/api/seo/aio-summary/route.ts')))

  const I = require('../lib/update-impact') as typeof import('../lib/update-impact')
  const soon = I.impactWindows('2026-09-20T12:00:00Z', now)
  check('too soon to measure says how long to wait', soon.ready === false && soon.readyInDays === 9)
  const w = I.impactWindows('2026-08-01T12:00:00Z', now)
  check('the windows are equal, either side of the update day, and end before data settles',
    w.ready === true && w.days === 28 && w.before.startDate === '2026-07-04' && w.before.endDate === '2026-07-31' && w.after.startDate === '2026-08-02' && w.after.endDate === '2026-08-29')
  check('a property only measures its own site',
    I.propertyCovers('sc-domain:example.com', 'https://www.example.com/a') && I.propertyCovers('https://example.com/', 'https://example.com/b') && !I.propertyCovers('sc-domain:example.com', 'https://other.com/a'))
  const A = read('app/api/blog/refresh/route.ts')
  check('a failed Search Console call reads as unavailable, not as zero', /before === null \|\| after === null\s*\? \{ state: 'unavailable' \}/.test(A) && /querySearchAnalyticsOrNull/.test(A))
  check('the panel says each state in its own words', ['waiting', 'no-search-console', 'other-site', 'unavailable', 'measured'].every((k) => read('components/content/PostUpdates.tsx').includes(`case '${k}'`)))
}

// ── The panels above the generator stay small (29 Sep) ──
{
  const U = read('components/content/PostUpdates.tsx')
  check('post updates are one bar, closed unless opened, one review at a time',
    /useState\(false\)[\s\S]{0,200}localStorage\.getItem\('mvp\.postUpdates\.open'\) === '1'/.test(U) && /\{open && \(/.test(U) && /due\[Math\.min\(index, due\.length - 1\)\]/.test(U) && !/due\.map\(/.test(U))
  check('held drafts show three until asked', /\(all \? held : held\.slice\(0, 3\)\)\.map/.test(read('components/content/HeldPosts.tsx')))
}

if (failures.length) {
  console.error(`\n❌ blog-quality: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-quality: one consistent set of instructions, the answer first, and no experience nobody had')
