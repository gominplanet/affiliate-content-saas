// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Would this page help someone who does not know SEO?
//
// The test subject is Lisa: she runs an affiliate blog, she does not know what
// a crawler is, and she opens this page wanting to know what to do today. Every
// assertion here is about her, not about the data: that the worst problem comes
// first, that nothing claims a fix MVP cannot perform, and that a healthy blog
// is told it is healthy instead of being handed invented chores.
import { seoNextSteps, type SeoSignals } from '../lib/seo-next-steps'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const base: SeoSignals = {
  posts: 13, connected: true, indexed: 13, notIndexed: 0, unknown: 0,
  notInSitemap: 0, urlGuessed: 0, recentlyDropped: 0, sitemapFound: true,
  totalClicks: 40, totalImpressions: 2000,
  crawlersBlocked: 0, crawlersTotal: 8,
  aio: { scored: 13, avgScore: 80, topFix: null },
}

// ── Lisa's actual blog, from the screenshot ─────────────────────────────────
// 13 posts, everything healthy, and one check failing on every single post.
{
  const steps = seoNextSteps({
    ...base,
    aio: {
      scored: 13, avgScore: 80,
      topFix: {
        label: 'Answer-first opening',
        hint: 'Open with a tight 2–3 sentence direct answer before the first heading — the block AI engines quote.',
        share: 100, count: 13,
      },
    },
  })
  check('the one thing wrong is surfaced', steps.length >= 1, `${steps.length} steps`)
  check('and it leads', steps[0].id.startsWith('aio-'), steps[0].id)
  check('it says every post, because every post is what it is',
    /every one of your 13/i.test(steps[0].title), steps[0].title)
  // MVP has no answer-first fix, so it must not imply a button exists.
  check('it does not promise a fix MVP cannot perform', steps[0].action === 'none', steps[0].action)
  check('and it says who does the work', /small edit|already published/i.test(steps[0].doThis), steps[0].doThis)
}

// ── a healthy blog is told so, not given busywork ───────────────────────────
{
  const steps = seoNextSteps(base)
  check('a clean blog gets one line, not four chores', steps.length === 1, `${steps.length} steps`)
  check('and it is the all-clear', steps[0].id === 'all-clear', steps[0].id)
  check('which points at writing rather than settings',
    steps[0].action === 'write' && /more posts/i.test(steps[0].doThis), steps[0].doThis)
}

// ── ranking: the expensive thing first ──────────────────────────────────────
{
  const steps = seoNextSteps({
    ...base,
    connected: false, notIndexed: 6, indexed: 7, recentlyDropped: 3, notInSitemap: 2,
    crawlersBlocked: 2,
    aio: { scored: 13, avgScore: 80, topFix: { label: 'Answer-first opening', hint: 'h', share: 100, count: 13 } },
  })
  check('a site AI engines cannot read comes before everything',
    steps[0].id === 'crawlers-blocked', steps.map(x => x.id).join(' > '))
  check('lost traffic outranks a content improvement',
    steps.findIndex(x => x.id === 'dropped') < steps.findIndex(x => x.id.startsWith('aio-')),
    steps.map(x => x.id).join(' > '))
  check('the list stays short enough to act on', steps.length <= 4, `${steps.length} steps`)
}

// ── nothing published ───────────────────────────────────────────────────────
{
  const steps = seoNextSteps({ ...base, posts: 0, indexed: 0, aio: null })
  check('an empty blog is told to write, and nothing else', steps.length === 1 && steps[0].id === 'no-posts',
    steps.map(x => x.id).join(', '))
}

// ── every step says who does the work ───────────────────────────────────────
// A page of problems the reader has to solve alone is a page they stop opening.
{
  const all = [
    seoNextSteps(base),
    seoNextSteps({ ...base, connected: false }),
    seoNextSteps({ ...base, urlGuessed: 111 }),
    seoNextSteps({ ...base, totalImpressions: 408, totalClicks: 0 }),
    seoNextSteps({ ...base, indexed: 28, notIndexed: 111, unknown: 140 }),
  ].flat()
  check('every step names who performs it', all.every(x => x.who === 'mvp' || x.who === 'you'))
  check('most of them are MVP’s job, not the creator’s',
    all.filter(x => x.who === 'mvp').length >= all.filter(x => x.who === 'you').length,
    `${all.filter(x => x.who === 'mvp').length} mvp vs ${all.filter(x => x.who === 'you').length} you`)
}

// ── a guessed address is not an indexing problem ────────────────────────────
// This is why pressing the ping button for weeks changed nothing: the pages
// were fine, MVP was asking Google about addresses it had invented.
{
  const steps = seoNextSteps({ ...base, urlGuessed: 111, notIndexed: 111, indexed: 28, unknown: 140 })
  const g = steps.find(x => x.id === 'url-guessed')
  check('guessed addresses are surfaced', !!g, steps.map(x => x.id).join(', '))
  check('and ranked above the indexing step they were faking',
    steps.findIndex(x => x.id === 'url-guessed') < steps.findIndex(x => x.id === 'not-indexed'),
    steps.map(x => x.id).join(' > '))
  check('the fix is refreshing the addresses, not another ping',
    g?.action === 'refresh-urls', g?.action)
  check('and it says plainly that pinging cannot help',
    !!g && /pinging Google again cannot help/i.test(g.why), g?.why)
  check('MVP does it', g?.who === 'mvp')
}

// ── ranking with no clicks points at a control, not an instruction ──────────
{
  const steps = seoNextSteps({ ...base, totalImpressions: 408, totalClicks: 0 })
  const t = steps.find(x => x.id === 'titles')
  check('being shown and never clicked is surfaced', !!t, steps.map(x => x.id).join(', '))
  check('and opens Title Check rather than telling them to go find it',
    t?.action === 'titles', t?.action)
  check('MVP drafts the titles', t?.who === 'mvp')
}

// ── the ping step stops implying that repetition helps ──────────────────────
{
  const steps = seoNextSteps({ ...base, indexed: 28, notIndexed: 111, unknown: 140 })
  const idx = steps.find(x => x.id === 'not-indexed')
  check('running it repeatedly is called out as useless',
    !!idx && /Running it repeatedly does nothing extra/i.test(idx.doThis), idx?.doThis)
}

// ── unchecked posts are not silently counted as fine ────────────────────────
// The real page showed "111 of your 279 not in Google" while only 28 were
// confirmed indexed and 140 had never been checked. Leading on the missing count
// implies the remainder are fine, and 140 of them were simply unknown.
{
  const steps = seoNextSteps({ ...base, posts: 279, indexed: 28, notIndexed: 111, unknown: 140 })
  const idx = steps.find(x => x.id === 'not-indexed')
  check('the headline is what is confirmed, not what is missing',
    !!idx && /only 28 of your 279/i.test(idx.title), idx?.title)
  check('and the unchecked posts are named rather than assumed fine',
    !!idx && /140 have not been checked/i.test(idx.why), idx?.why)
  check('with the reason they are unchecked, so it does not read as a fault',
    !!idx && /normal on a blog this size/i.test(idx.why), idx?.why)
}

// A blog where everything has been checked and everything is in Google should
// not be handed an indexing chore at all.
{
  const steps = seoNextSteps({ ...base, posts: 13, indexed: 13, notIndexed: 0, unknown: 0 })
  check('a fully indexed blog gets no indexing step',
    !steps.some(x => x.id === 'not-indexed'), steps.map(x => x.id).join(', '))
}

// ── indexing is never claimed without Search Console ────────────────────────
// notIndexed is meaningless when we cannot ask Google, so it must not be
// reported as fact to someone who would then go hunting for a cause.
{
  const steps = seoNextSteps({ ...base, connected: false, notIndexed: 9, indexed: 4 })
  check('no indexing claim is made while disconnected',
    !steps.some(x => x.id === 'not-indexed'), steps.map(x => x.id).join(', '))
  check('connecting is offered instead', steps.some(x => x.id === 'connect-gsc'))
}

// ── a weak signal must not become a headline ────────────────────────────────
{
  const few = seoNextSteps({
    ...base,
    aio: { scored: 2, avgScore: 80, topFix: { label: 'Answer-first opening', hint: 'h', share: 100, count: 2 } },
  })
  check('two posts is not enough to call a pattern',
    !few.some(x => x.id.startsWith('aio-')), few.map(x => x.id).join(', '))

  const minority = seoNextSteps({
    ...base,
    aio: { scored: 13, avgScore: 80, topFix: { label: 'Sourced claims', hint: 'h', share: 20, count: 3 } },
  })
  check('a check failing on a fifth of posts is not the headline',
    !minority.some(x => x.id.startsWith('aio-')), minority.map(x => x.id).join(', '))
}

// ── ranking without clicks is its own problem ───────────────────────────────
{
  const steps = seoNextSteps({ ...base, totalImpressions: 4000, totalClicks: 0 })
  const t = steps.find(x => x.id === 'titles')
  check('being seen and not clicked is surfaced', !!t, steps.map(x => x.id).join(', '))
  check('and named as the sentence they wrote, not a search problem',
    !!t && /not about search at all/i.test(t.why), t?.why)
}

// ── the language itself ─────────────────────────────────────────────────────
// Lisa does not know these words. If any of them reach her, the page has failed
// at the only job it has.
{
  const all = [
    seoNextSteps(base),
    seoNextSteps({ ...base, connected: false }),
    seoNextSteps({ ...base, notIndexed: 4, indexed: 9 }),
    seoNextSteps({ ...base, crawlersBlocked: 3 }),
    seoNextSteps({ ...base, recentlyDropped: 2 }),
    seoNextSteps({ ...base, notInSitemap: 3 }),
  ].flat()
  const jargon = /\b(canonical|noindex|SERP|crawl budget|robots meta|indexation|schema markup|E-E-A-T|AIO)\b/i
  for (const step of all) {
    const text = `${step.title} ${step.why} ${step.doThis}`
    check(`no jargon in "${step.id}"`, !jargon.test(text), (text.match(jargon) || [])[0])
  }
  check('every step says what to do', all.every(x => x.doThis.trim().length > 10))
  check('every step says why it matters', all.every(x => x.why.trim().length > 20))
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
