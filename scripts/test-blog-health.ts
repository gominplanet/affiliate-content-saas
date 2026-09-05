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
import { analyseBlogHealth, findCollapse, type BlogHealthInput, type DailyPoint } from '../lib/blog-health'

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

const base: BlogHealthInput = {
  daily: [], connected: true, posts: 279,
  firstPublishedAt: '2024-01-15T00:00:00Z',
  affiliateClicks: null, offsiteEarningsCents: null,
}

// ── the failure this file exists for ────────────────────────────────────────
// Traffic ran at ~45 a day for a month, then the site broke and it went to zero.
{
  const daily = [...series(30, 45, 2), ...series(6, 0, 0, 30)]
  const h = analyseBlogHealth({ ...base, daily })
  check('a collapse is detected at all', !!h.collapse, 'this is the exact case MVP missed')
  check('and dated, so it can be lined up against what changed',
    h.collapse?.date === daily[30].date, `${h.collapse?.date} vs ${daily[30].date}`)
  check('the verdict leads with the collapse, not with an average',
    /stopped on/i.test(h.verdict), h.verdict)
  check('and it says what kind of problem this is',
    /break, not a slow decline/i.test(h.doThis), h.doThis)
  check('the previous level is stated so the loss is legible',
    (h.collapse?.before ?? 0) >= 40, `${h.collapse?.before}`)
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

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
