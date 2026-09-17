// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the blog health read tell a creator the truth about their blog?
//
// This exists because of a real failure. A site broke, its Google traffic went
// to zero, and MVP said nothing: it was showing a 28-day impression total that
// averaged the collapse away, so the creator found out from their host's
// bandwidth chart. Meanwhile the same page reported an SEO score of 99 out of
// 100. Every assertion below is about not doing that again.
//
// The other half is about not being cruel with a true number. A six week old
// blog with no clicks is behaving exactly as expected, and calling that failure
// is how people quit two months before it would have worked.
import { analyseBlogHealth, classifyReachUrl, countReach, findCollapse, readReach, type BlogHealthInput, type DailyPoint, type ReachWindows } from '../lib/blog-health'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** N days of steady traffic, ending `endDaysAgo` days back. */
function series(days: number, impressions: number, clicks = 0, startDay = 0, position: number | null = 6): DailyPoint[] {
  const out: DailyPoint[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 5, 1 + startDay + i))
    out.push({ date: d.toISOString().slice(0, 10), impressions, clicks, position })
  }
  return out
}

/** Three reach windows from post counts, with optional archive counts. */
function reach(posts: [number, number, number], archives: [number, number, number] = [0, 0, 0]): ReachWindows {
  return {
    windows: [0, 1, 2].map(i => ({
      posts: posts[i], archives: archives[i], total: posts[i] + archives[i],
    })) as ReachWindows['windows'],
  }
}

const base: BlogHealthInput = {
  daily: [], connected: true, posts: 279,
  firstPublishedAt: '2024-01-15T00:00:00Z',
  affiliateClicks: null, offsiteEarningsCents: null,
}

// ── the failure this file exists for ────────────────────────────────────────
// Traffic ran at ~45 a day for a month, then the site broke and it went to zero.
// Reach held up through it, so the site really was still in Google when the
// traffic stopped and the one-day claim is earned.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily, reach: reach([120, 118, 115]) })
  check('a collapse is detected at all', !!h.collapse, 'this is the exact case MVP missed')
  check('and dated, so it can be lined up against what changed',
    h.collapse?.date === daily[30].date, `${h.collapse?.date} vs ${daily[30].date}`)
  check('the verdict leads with the collapse, not with an average',
    /stopped on/i.test(h.verdict), h.verdict)
  check('and it says what kind of problem this is',
    /break rather than a slow decline/i.test(h.doThis), h.doThis)
  check('the previous level is stated so the loss is legible',
    (h.collapse?.before ?? 0) >= 40, `${h.collapse?.before}`)
  check('and the evidence for calling it a break is shown, not just asserted',
    /still showing 115 of your pages/i.test(h.verdict), h.verdict)
}

// ── the second failure: a deindexing wearing a collapse's clothes ───────────
// Measured, on the owner's own blog. Impressions ran 48 a day on 29 August, 2 on
// the 30th, then zero for a fortnight. That is the shape of a site going down,
// and the page said so: "This is a break, not a slow decline, so look for
// something that changed that day." Nothing changed that day. The indexed page
// count had been falling since the end of June, 1,076 pages down to 47, and the
// last of those leaving is what the impression chart was showing. He spent a day
// hunting a 1 September change that did not exist.
//
// The impressions in this case are indistinguishable from the case above, which
// is the whole point: only the reach tells them apart.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily, reach: reach([1076, 361, 47]) })
  check('the stop is still reported', !!h.collapse)
  check('but it is NOT called a one-day break',
    !/break rather than a slow decline|changed that day: the site going down/i.test(h.doThis), h.doThis)
  check('the creator is not sent hunting for a change on the collapse date',
    !/something changed that day/i.test(h.doThis), h.doThis)
  check('the slide is named as the cause',
    /dropping out of Google/i.test(h.doThis), h.doThis)
  check('and the measurement behind that claim is on screen',
    /fell from 1076 to 47/i.test(h.verdict), h.verdict)
  check('with the honest statement that it did not begin on the collapse date',
    /did not start that day/i.test(h.verdict), h.verdict)
}

// ── with no reach measurement, assert neither ───────────────────────────────
// The old wording was wrong not because it picked the wrong cause but because it
// picked one at all from evidence that cannot distinguish them. Unmeasured must
// mean undecided.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily })
  check('unmeasured reach is reported as unknown', h.reach.trend === 'unknown', h.reach.trend)
  check('and no cause is asserted either way',
    !/break rather than a slow decline/i.test(h.doThis) && !/dropping out of Google/i.test(h.doThis),
    h.doThis)
  check('the creator is given a way to tell the two apart themselves',
    /whether the page still loads/i.test(h.doThis), h.doThis)
}

// ── a failed API call must never be read as a dead site ─────────────────────
// querySearchAnalytics returns [] on a timeout as readily as on an empty site.
// Counting rows off that would tell a creator with a working blog that every
// page had fallen out of Google.
{
  check('a reach of null is unknown, not shrinking',
    readReach(null, 0).trend === 'unknown')
  check('zero pages alongside real impressions is a broken measurement, not a dead site',
    readReach(reach([400, 200, 0]), 900).trend === 'unknown',
    readReach(reach([400, 200, 0]), 900).trend)
  check('but zero pages alongside zero impressions is believable',
    readReach(reach([400, 200, 0]), 0).trend === 'shrinking',
    readReach(reach([400, 200, 0]), 0).trend)
}

// ── a small blog is not deindexing ──────────────────────────────────────────
{
  check('three pages becoming one is not called a deindexing',
    readReach(reach([3, 2, 1]), 0).trend === 'unknown')
  check('a steady site is steady', readReach(reach([100, 98, 95]), 500).trend === 'steady')
  check('a growing site is growing', readReach(reach([100, 130, 180]), 500).trend === 'growing')
  check('a recovery is not called a slide',
    readReach(reach([100, 40, 95]), 500).trend === 'steady',
    readReach(reach([100, 40, 95]), 500).trend)
}

// ── caught before it reaches zero ───────────────────────────────────────────
// The same disease, a month earlier, when the impressions have not flatlined
// long enough for findCollapse to fire.
{
  const h = analyseBlogHealth({ ...base, daily: series(40, 0, 0), reach: reach([900, 400, 60]) })
  check('a site with no traffic and shrinking reach is told it is being dropped',
    /being dropped rather than never picked up/i.test(h.verdict), h.verdict)
  check('and pointed at the Pages report rather than at internal linking',
    /Search Console, go to Pages/i.test(h.doThis), h.doThis)

  // A site Google simply never took gets the original advice, not this one.
  const never = analyseBlogHealth({ ...base, daily: series(40, 0, 0), reach: reach([0, 0, 0]) })
  check('a site Google never picked up is not accused of losing pages',
    !/being dropped/i.test(never.verdict), never.verdict)
}

// ── a quiet blog has not crashed ────────────────────────────────────────────
// The difference between "was never being shown" and "was and then stopped"
// decides whether someone goes hunting for a fault that does not exist.
{
  const daily = [...series(30, 1, 0), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily })
  check('a blog that was always quiet is not told it crashed', !h.collapse,
    JSON.stringify(h.collapse))
}

// ── a dip is not a collapse ─────────────────────────────────────────────────
{
  const daily = [...series(30, 45, 2), ...series(6, 12, 0, 30)]
  check('a decline to a lower level is not reported as a stop', !findCollapse(daily))
}

// ── two days of quiet is not a collapse either ──────────────────────────────
{
  const daily = [...series(30, 45, 2), ...series(2, 0, 0, 30)]
  check('a weekend of nothing is not an alarm', !findCollapse(daily))
}

// ── a young blog is not a failing blog ──────────────────────────────────────
{
  const h = analyseBlogHealth({
    ...base, posts: 12, firstPublishedAt: new Date().toISOString(),
    daily: series(20, 0, 0),
  })
  check('a brand new blog with no traffic is called normal', h.tooEarly === true)
  check('and told so in the verdict', /normal/i.test(h.verdict), h.verdict)
  check('and told to keep going rather than to fix something',
    /keep publishing/i.test(h.doThis), h.doThis)
  check('nothing is called wrong', !/wrong|problem|fail/i.test(h.verdict), h.verdict)
}

// ── an old blog with the same numbers IS a problem ──────────────────────────
// The same zero means opposite things at six weeks and at two years.
{
  const h = analyseBlogHealth({
    ...base, posts: 279, firstPublishedAt: '2024-01-15T00:00:00Z',
    daily: series(40, 0, 0),
  })
  check('an established blog with no traffic is not excused', h.tooEarly === false)
  check('and is told plainly', /not showing your posts/i.test(h.verdict), h.verdict)
}

// ── the chain, and which link is broken ─────────────────────────────────────
{
  // Shown, never clicked. A title problem, not a ranking problem.
  const shown = analyseBlogHealth({ ...base, daily: series(30, 20, 0) })
  check('shown but never clicked is identified', shown.stage === 'not-clicked', shown.stage)
  check('and named as a headline problem', /headline problem/i.test(shown.doThis), shown.doThis)

  // Read, but nobody follows a product link.
  const read = analyseBlogHealth({ ...base, daily: series(30, 200, 8), affiliateClicks: 0 })
  check('readers who never click a link are identified',
    read.stage === 'not-following-links', read.stage)

  // Clicking through and not buying.
  const clicking = analyseBlogHealth({
    ...base, daily: series(30, 200, 8), affiliateClicks: 30, offsiteEarningsCents: 0,
  })
  check('clicks that never become sales are identified', clicking.stage === 'not-buying', clicking.stage)
  check('and blamed on the product rather than the writing',
    /the product rather than the post/i.test(clicking.doThis), clicking.doThis)

  // All the way through.
  const working = analyseBlogHealth({
    ...base, daily: series(30, 400, 40), affiliateClicks: 60, offsiteEarningsCents: 7700,
  })
  check('a working chain is recognised', working.stage === 'working', working.stage)
}

// ── buried is not the same as ignored ───────────────────────────────────────
// The real blog: 1,480 impressions over three months, 4 clicks, average
// position 25.8. Those look identical to a title problem in the click count and
// have opposite fixes. Telling someone at position 26 to rewrite their titles
// costs them weeks and changes nothing, because almost nobody reaches page three.
{
  const buried = analyseBlogHealth({ ...base, daily: series(30, 16, 0, 0, 25.8) })
  check('being buried is told apart from being ignored', buried.stage === 'not-ranking', buried.stage)
  check('the page number is stated, not the raw position',
    /page 3 of the results/i.test(buried.verdict), buried.verdict)
  check('and it explicitly says titles are not the fix',
    /Rewriting them will not help/i.test(buried.doThis), buried.doThis)
  check('the average position is reported', Math.round(buried.avgPosition ?? 0) === 26,
    `${buried.avgPosition}`)

  // On page one, the same zero IS the title's fault.
  const ignored = analyseBlogHealth({ ...base, daily: series(30, 400, 0, 0, 4) })
  check('on page one, zero clicks is a title problem again', ignored.stage === 'not-clicked', ignored.stage)
  check('and there it does say to rewrite them',
    /Rewrite the titles/i.test(ignored.doThis), ignored.doThis)
}

// ── position is weighted by how much it was actually seen ───────────────────
// A day with two impressions must not drag the average as hard as a day with
// two hundred, or one quiet outlier decides the whole diagnosis.
{
  const daily = [...series(27, 200, 0, 0, 30), ...series(1, 2, 0, 27, 1)]
  const h = analyseBlogHealth({ ...base, daily })
  check('a tiny day does not swing the average', (h.avgPosition ?? 0) > 25, `${h.avgPosition}`)
  check('so the diagnosis stays buried', h.stage === 'not-ranking', h.stage)
}

// ── no tracked links is not the same as nobody clicking ─────────────────────
// This is the accusation the page must never invent. A creator who has not put
// Passport links in their posts has told us nothing about their readers, and
// "none of them clicked a product link" would be a failure conjured from an
// absence of data.
{
  const untracked = analyseBlogHealth({ ...base, daily: series(30, 200, 8), affiliateClicks: null })
  check('with no tracked links, readers are not accused of ignoring them',
    untracked.stage !== 'not-following-links', untracked.stage)
  check('and nothing in the wording claims they did',
    !/none of them clicked|no product clicks/i.test(`${untracked.verdict} ${untracked.doThis}`),
    `${untracked.verdict} ${untracked.doThis}`)

  const tracked = analyseBlogHealth({ ...base, daily: series(30, 200, 8), affiliateClicks: 0 })
  check('but with links in place and no clicks, it IS reported',
    tracked.stage === 'not-following-links', tracked.stage)
}

// ── growth is stated against the period before ──────────────────────────────
{
  const daily = [...series(28, 100, 10), ...series(28, 100, 20, 28)]
  const h = analyseBlogHealth({ ...base, daily, affiliateClicks: 5, offsiteEarningsCents: 100 })
  check('growth against the previous 28 days is reported',
    /up 100%/i.test(h.verdict), h.verdict)
}

// ── never claim the blog earned what the blog cannot be shown to have earned ─
// Offsite Amazon earnings cover every link placed anywhere, YouTube included,
// and Amazon does not say which sent the buyer.
{
  const h = analyseBlogHealth({
    ...base, daily: series(30, 400, 40), affiliateClicks: 60, offsiteEarningsCents: 50000,
  })
  const text = `${h.verdict} ${h.doThis}`
  check('no sentence credits the blog with the money',
    !/your blog (earned|made)|blog revenue|earned \$/i.test(text), text)
}

// ── disconnected ────────────────────────────────────────────────────────────
{
  const h = analyseBlogHealth({ ...base, connected: false, daily: [] })
  check('without Search Console it says it cannot see, not that things are bad',
    /cannot see/i.test(h.verdict) && !/failing|wrong/i.test(h.verdict), h.verdict)
}

// ── our own cleanup, told apart from the disease ────────────────────────────
// MVP's WordPress plugin started noindexing tag, author, date, search and
// paginated archives on 20 August 2026, and dropped tags from the sitemap the
// same day. On the owner's blog the indexed count went from losing 11 pages a
// day to losing 55 a day in the week that landed. That was the cleanup working
// as designed, on pages earning close to nothing.
//
// Every creator running that plugin saw the same cliff. If this page calls our
// own intended change a catastrophe, we manufacture a support ticket for each
// of them and send every one hunting a fault that does not exist.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily, reach: reach([90, 88, 86], [400, 210, 12]) })
  check('archives leaving while the posts stay is flagged as such', h.reach.archivesOnly === true)
  check('and the posts are not called dropped', h.reach.trend !== 'shrinking', h.reach.trend)
  check('the creator is told the drop was us, by name',
    /MVP noindexes them on purpose/i.test(h.verdict), h.verdict)
  check('and told plainly to ignore that part',
    /Ignore the drop in your indexed page count, that part was us/i.test(h.doThis), h.doThis)
  check('the archive numbers behind the claim are shown',
    /from 400 to 12/i.test(h.verdict), h.verdict)
  check('while the separate traffic question is still put to them',
    /separate question/i.test(h.doThis), h.doThis)
}

// ── but archives leaving is NO excuse when the posts went too ───────────────
// This is the dangerous half. Reassuring someone whose articles are actually
// falling out of Google is worse than the alarm it replaces.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily, reach: reach([1076, 361, 47], [400, 210, 12]) })
  check('posts dropping with the archives is NOT called housekeeping',
    h.reach.archivesOnly === false)
  check('and nothing tells them to ignore it',
    !/Ignore the drop/i.test(h.doThis), h.doThis)
  check('they are told their posts are being dropped',
    /dropping out of Google/i.test(h.doThis), h.doThis)
}

// ── which URL is an article and which is a tag page ─────────────────────────
// The split above is only as good as this, and a post on a dated permalink
// misread as a date archive would quietly move real articles into the column
// the page tells people to ignore.
{
  const post = (u: string) => classifyReachUrl(u) === 'post'
  const arch = (u: string) => classifyReachUrl(u) === 'archive'
  check('a normal post is a post', post('https://gominreviews.com/dewalt-20v-battery-usb-adapter-review/'))
  check('a dated permalink is still a post', post('https://gominreviews.com/2026/08/14/dewalt-review/'),
    'this is the one that would hide real articles')
  check('a tag page is an archive', arch('https://gominreviews.com/tag/power-tools/'))
  check('an author page is an archive', arch('https://gominreviews.com/author/seb/'))
  check('a category page is an archive', arch('https://gominreviews.com/category/home-kitchen/'))
  check('a bare date is an archive', arch('https://gominreviews.com/2026/08/'))
  check('a paginated archive is an archive', arch('https://gominreviews.com/page/3/'))
  check('a search page is an archive', arch('https://gominreviews.com/?s=dewalt'))
  check('a feed is an archive', arch('https://gominreviews.com/feed/'))
  check('the homepage is neither', classifyReachUrl('https://gominreviews.com/') === 'other',
    'counting it as a post puts a permanent +1 on one side of the comparison')
  check('an unparseable row is neither', classifyReachUrl('not a url') === 'other')

  const w = countReach([
    'https://gominreviews.com/',
    'https://gominreviews.com/dewalt-review/',
    'https://gominreviews.com/2026/08/14/another-review/',
    'https://gominreviews.com/tag/tools/',
    'https://gominreviews.com/category/home-kitchen/',
  ])
  check('counted into the right columns', w.posts === 2 && w.archives === 2 && w.total === 5,
    JSON.stringify(w))
}

// ── the wiring, which no fixture above can reach ────────────────────────────
// readReach can be perfect and the feature still lie, because the numbers it
// reads are counted in the route. Two mistakes there produce a confident false
// claim, and both are one word wide.
{
  const root = join(__dirname, '..')
  const strip = (src: string) => src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
  const ROUTE = strip(readFileSync(join(root, 'app/api/seo/blog-health/route.ts'), 'utf8'))
  const GSC = strip(readFileSync(join(root, 'lib/gsc.ts'), 'utf8'))

  check('the comment stripper works',
    strip('  // querySearchAnalytics(\nreal code').indexOf('querySearchAnalytics(') === -1,
    'if this fails every check below proves nothing')

  // Mistake one: counting rows off the swallowing version. A timeout returns []
  // there, and [] counted is zero pages, which reads as the whole site gone.
  check('the reach windows are counted off the version that can report failure',
    /querySearchAnalyticsOrNull\(token, property, \{[\s\S]{0,200}?dimensions: \['page'\]/.test(ROUTE),
    'the reach count must not use the [] on error version')

  // Mistake three: tallying rows instead of classifying the URLs, which is the
  // version that reports our own archive noindex as the site collapsing.
  check('the URLs are classified, not just counted',
    /countReach\(/.test(ROUTE) && !/rows\.filter\([^)]*\)\.length/.test(ROUTE),
    'a bare row count cannot tell a tag page from an article')

  // Mistake two: filling in the windows it could read and leaving the rest at
  // zero, which invents a slide out of one failed call.
  check('a window that could not be read voids the whole measurement',
    /counted\.every\(w => w !== null\)/.test(ROUTE),
    'all three windows or none')

  // And the two gsc helpers must keep meaning different things.
  check('querySearchAnalyticsOrNull returns null on a bad response',
    /if \(!res\.ok\) return null/.test(GSC), 'null is the signal that Google did not answer')
  check('while the plain one still gives callers an array',
    /querySearchAnalyticsOrNull\(token, property, opts\)\) \?\? \[\]/.test(GSC),
    'existing callers iterate the result and must not start seeing null')
}

// ── break tests ─────────────────────────────────────────────────────────────
// Every check above is worthless if it would also pass against the bug. These
// reintroduce each one and confirm the guard actually fires. They run here,
// ahead of the report, because a block appended after it is never read.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. Assert a one-day break regardless of reach.
  const deindexing = analyseBlogHealth({ ...base, daily, reach: reach([1076, 361, 47]) })
  broke('a deindexing would fail the one-day-break wording check',
    !/break rather than a slow decline/i.test(deindexing.doThis))
  broke('and would fail the changed-that-day check',
    !/something changed that day/i.test(deindexing.doThis))

  // Break 2: drop the small-site floor, so 3 pages to 1 becomes a deindexing.
  broke('the small-site floor is what makes [3,2,1] unknown',
    readReach(reach([3, 2, 1]), 0).trend === 'unknown'
    && readReach(reach([30, 20, 10]), 0).trend === 'shrinking')

  // Break 3: drop the impressions cross-check, so a failed newest window reads
  // as total deindexing on a site that is plainly still getting traffic.
  broke('the impressions cross-check is what catches a broken measurement',
    readReach(reach([400, 200, 0]), 900).trend === 'unknown'
    && readReach(reach([400, 200, 1]), 900).trend === 'shrinking')

  // Break 4: drop the middle <= oldest requirement, so a dip and recovery gets
  // called a slide.
  broke('the middle window is what separates a slide from a dip',
    readReach(reach([100, 140, 55]), 500).trend === 'steady'
    && readReach(reach([100, 90, 55]), 500).trend === 'shrinking')

  // Break 5: unknown reach falling through to either assertion.
  const unmeasured = analyseBlogHealth({ ...base, daily })
  broke('unknown reach reaches neither assertion',
    !/break rather than a slow decline/i.test(unmeasured.doThis)
    && !/dropping out of Google/i.test(unmeasured.doThis)
    && unmeasured.doThis.length > 80)

  // Break 6: archivesOnly dropping the "posts held" half of its condition, which
  // would tell someone whose articles ARE falling out of Google to ignore it.
  broke('archivesOnly requires the posts to have held',
    readReach(reach([90, 88, 86], [400, 210, 12]), 5).archivesOnly === true
    && readReach(reach([1076, 361, 47], [400, 210, 12]), 5).archivesOnly === false)

  // Break 7: classifying a dated permalink as a date archive, which silently
  // moves real articles into the column the page says to ignore.
  broke('a dated post permalink is not a date archive',
    classifyReachUrl('https://x.com/2026/08/14/a-real-post/') === 'post'
    && classifyReachUrl('https://x.com/2026/08/') === 'archive')

  // Break 8: counting the homepage as a post, a permanent +1 on one side.
  broke('the homepage is excluded from both columns',
    countReach(['https://x.com/']).posts === 0 && countReach(['https://x.com/']).archives === 0)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
