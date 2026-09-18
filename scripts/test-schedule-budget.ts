// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A THIRTY SECOND DEADLINE ON A FOUR MINUTE JOB.
//
// 8 Sep 2026, commit cc7b7a25, "Give outbound calls a deadline". A sensible
// change: fetchWithTimeout gained DEFAULT_TIMEOUT_MS, 30 seconds, so a hung
// WordPress site could not pin a request open forever.
//
// /api/blog/schedule-publish calls /api/blog/generate internally and names no
// deadline, so it inherited the default. Generating and publishing a post takes
// 250 to 290 seconds; the maxDuration comment at the top of that very file says
// so. From that day, every scheduled post aborted at thirty seconds.
//
// WHAT MADE IT INVISIBLE. Aborting the fetch does not stop the work. generate is
// a separate invocation: it carried on, finished, created the WordPress draft,
// and wrote scheduled_for and schedule_mode onto blog_posts. Only the rows after
// the await were lost, and those are the rows that publish the post and fire the
// social cascade. So the creator got a schedule recorded in his dashboard, a
// draft on his site, and nothing that would ever join them up. No failed row, no
// error message, nothing to query.
//
// The evidence, from his own account: two blog_publish rows and fourteen social
// rows every single day through 8 Sep, then none, ever. Ten stored post URLs
// still carrying the ?p=123 form WordPress uses before a post goes live, all ten
// fetching as 404.
//
// THIS IS THE SECOND TIME. The same regression hit the auto-pilot worker and was
// fixed on 10 Sep by teaching fetchWithTimeout to respect a caller-supplied
// signal. That fix could not reach this call, because this call named no budget
// at all, and nothing checked for the ones that had not. Hence this file.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TIMEOUT_MS, effectiveTimeoutMs } from '../lib/fetch-timeout'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const SCHEDULE = read('app/api/blog/schedule-publish/route.ts')
const SCHEDULE_LIVE = live(SCHEDULE)
const RUNNER = live(read('lib/generation-job-runner.ts'))

// ── the rule the default follows ────────────────────────────────────────────
{
  check('a caller who names nothing gets the short default',
    effectiveTimeoutMs(undefined, false) === DEFAULT_TIMEOUT_MS,
    'which is correct for ordinary API calls and fatal for a four minute one')
  check('and the default is still short enough to be dangerous here',
    DEFAULT_TIMEOUT_MS <= 60_000, String(DEFAULT_TIMEOUT_MS))
  check('a caller who names a signal keeps it',
    effectiveTimeoutMs(undefined, true) === null,
    'the 10 Sep fix, which saved auto-pilot and could not reach a caller that named nothing')
  check('and an explicit budget is always honoured',
    effectiveTimeoutMs(290_000, false) === 290_000 && effectiveTimeoutMs(290_000, true) === 290_000)
}

// ── the scheduled-publish path names its budget ─────────────────────────────
{
  check('the internal generate call passes an explicit timeout',
    /timeoutMs: GENERATE_BUDGET_MS/.test(SCHEDULE_LIVE),
    'without this it inherits 30 seconds and every scheduled post dies mid-generation')
  check('and an abort signal on the same budget',
    /signal: AbortSignal\.timeout\(GENERATE_BUDGET_MS\)/.test(SCHEDULE_LIVE),
    'matching the generation worker, which passes both')

  const m = SCHEDULE_LIVE.match(/const GENERATE_BUDGET_MS = ([0-9_]+)/)
  const budget = m ? Number(m[1].replace(/_/g, '')) : 0
  check('the budget is declared as a number, not left to a default',
    budget > 0, String(budget))
  check('it is long enough for a post that takes 250 to 290 seconds',
    budget >= 240_000, `${budget}ms`)
  check('and short enough to report the outcome before the platform cuts the request',
    budget <= 295_000, `${budget}ms, against a 300s clamp without Fluid Compute`)

  // Pinned against the worker rather than as a bare number: the two call the
  // same route to do the same work, and one of them drifting is how this
  // reappears on the path nobody was watching.
  const rm = RUNNER.match(/RUNNER_ABORT_MS = LONG_RUN \? [0-9_]+ : ([0-9_]+)/)
  const runnerBudget = rm ? Number(rm[1].replace(/_/g, '')) : 0
  check('it matches the budget the generation worker uses for the same call',
    budget === runnerBudget, `schedule-publish ${budget}, worker ${runnerBudget}`)
}

// ── the call happens before the rows that matter ────────────────────────────
//
// This is WHY a timeout here is silent rather than loud. Worth pinning so the
// ordering cannot be shuffled without somebody reading this.
{
  const gen = SCHEDULE_LIVE.indexOf('const genRes = await fetchWithTimeout')
  const parent = SCHEDULE_LIVE.indexOf("kind: 'blog_publish'")
  check('the generate call really does precede the schedule rows',
    gen !== -1 && parent !== -1 && gen < parent,
    'everything after the await is lost when the await is cut short, and none of it is retried')
  check('the route still refuses to report success when generate did not return a post',
    /!genJson\.success \|\| !genJson\.postId \|\| !genJson\.wordpressPostId/.test(SCHEDULE_LIVE),
    'the one thing that worked here: it errored rather than claiming a schedule it had not written')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
