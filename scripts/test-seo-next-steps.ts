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
  notInSitemap: 0, recentlyDropped: 0, sitemapFound: true,
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
  const s = steps.find(x => x.id === 'impressions-no-clicks')
  check('being seen and not clicked is surfaced', !!s, steps.map(x => x.id).join(', '))
  check('and named as a headline problem rather than a ranking one',
    !!s && /headline/i.test(s.why), s?.why)
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
