// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SCHEDULE THAT NEEDS A HUMAN TO FINISH IT IS NOT A SCHEDULE.
//
// Yesterday's fix made missed schedules visible: the list asks WordPress, an
// overdue post shows in red, and there is a Publish it now button. That answers
// "what happened to my post" and leaves the creator pressing a button every day
// for something they already told MVP to do. Asked directly: "will this happen
// again to eric?" It would have.
//
// The diagnosis was never the missing piece. app/api/admin/missed-schedules has
// carried it for months, in its own words — "nothing in MVP would ever say so,
// because nothing asks" — on an admin screen no creator can open. So the cron
// now finishes the job, and this file pins the two things that make that safe
// rather than reckless.
//
//   1. What it may publish depends on the MODE, and getting that wrong in
//      either direction is a real failure. 'future' is always safe. A 'draft'
//      is safe ONLY in draft-flip mode, where MVP created the draft itself for
//      our cron to flip; in any other mode a draft can be a human decision and
//      publishing over it would be MVP overruling a person.
//   2. One creator's backlog cannot take the whole tick, and cannot land forty
//      articles on a blog in one minute.
//
// The first version of rule 1 refused every draft. That looked like caution and
// was wrong: the creator who reported this is almost entirely draft-flip, so
// the careful rule would have walked past all ten of his stuck posts while
// reporting itself as a fix. Ten URLs fetched, ten 404s, and the mode column
// in his own rows is what showed it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  takeFairly, mayAutoPublish,
  GRACE_MINUTES, MAX_AGE_DAYS, MAX_PER_USER_PER_TICK, MAX_PER_TICK,
  type HealCandidate,
} from '../lib/missed-schedule-heal'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const HEAL = read('lib/missed-schedule-heal.ts')
const HEAL_LIVE = live(HEAL)
const CRON = live(read('app/api/cron/process-scheduled/route.ts'))

// A declaration, not an arrow. `(...): HealCandidate => ({...})` reads the
// return annotation as the start of a function TYPE and produces a bewildering
// error about the object literal being a parameter list.
function candidate(id: string, user: string, when: string): HealCandidate {
  return {
    id, user_id: user, title: id, wordpress_post_id: 1, wordpress_site_id: null,
    wordpress_url: null, scheduled_for: when, schedule_mode: 'wp-native',
  }
}

// ── what may be published on somebody's behalf ──────────────────────────────
//
// The single most important rule in the file, so it is a pure function with its
// own test rather than a condition buried in a loop.
{
  check('a post WordPress still holds as scheduled is published, in either mode',
    mayAutoPublish('future', 'wp-native') === true && mayAutoPublish('future', 'draft-flip') === true,
    'this is the missed schedule, and publishing it carries out the creator\'s own instruction')

  // THE CORRECTION. The first version of this refused every draft, which read
  // as caution and was simply wrong for draft-flip: there the draft is MVP's
  // own staging state and the flip is the step WE failed to take. The creator
  // who reported this is almost entirely draft-flip, so the careful version of
  // this rule would have walked past all ten of his stuck posts. Verified by
  // fetching all ten URLs: every one a 404.
  check('a draft-flip draft IS published, because that draft is our own unfinished work',
    mayAutoPublish('draft', 'draft-flip') === true,
    'MVP created it as a draft on purpose so our cron could flip it')
  check('a draft in any other mode is NEVER published automatically',
    mayAutoPublish('draft', 'wp-native') === false && mayAutoPublish('draft', null) === false
      && mayAutoPublish('draft', '') === false && mayAutoPublish('draft', 'something-new') === false,
    'there a draft can only be a human decision, and a creator who unpublished their own post must not have MVP put it back')
  check('nor is a pending post, in any mode',
    mayAutoPublish('pending', 'draft-flip') === false && mayAutoPublish('pending', 'wp-native') === false,
    'pending means somebody is holding it back on purpose')
  check('nor private, trashed or anything else WordPress invents later',
    !mayAutoPublish('private', 'draft-flip') && !mayAutoPublish('trash', 'draft-flip')
      && !mayAutoPublish('inherit', 'draft-flip') && !mayAutoPublish('', 'draft-flip')
      && !mayAutoPublish(null, 'draft-flip') && !mayAutoPublish(undefined, 'draft-flip'),
    'a short allow-list, so a status nobody anticipated defaults to leaving it alone')
  check('and an already-published post is not re-published',
    mayAutoPublish('publish', 'draft-flip') === false && mayAutoPublish('publish', 'wp-native') === false,
    'it is handled as confirmed, not as work')
}

// ── one creator cannot take the tick, or flood their own blog ───────────────
{
  const many = Array.from({ length: 200 }, (_, i) =>
    candidate(`a${i}`, 'userA', `2026-09-0${(i % 9) + 1}T00:00:00.000Z`))
  const few = [candidate('b1', 'userB', '2026-09-01T00:00:00.000Z')]
  const picked = takeFairly([...many, ...few])

  check('a 200-post backlog does not consume the whole tick',
    picked.filter((p) => p.user_id === 'userA').length === MAX_PER_USER_PER_TICK,
    `${picked.filter((p) => p.user_id === 'userA').length}`)
  check('and the creator with one stuck post is not starved behind it',
    picked.some((p) => p.user_id === 'userB'),
    'the fairness rule exists for exactly this creator')
  check('the tick total is capped',
    picked.length <= MAX_PER_TICK, `${picked.length}`)

  // Oldest first. The post that has been waiting longest is the one the creator
  // has been waiting longest for.
  const ordered = takeFairly([
    candidate('new', 'u', '2026-09-10T00:00:00.000Z'),
    candidate('old', 'u', '2026-09-01T00:00:00.000Z'),
    candidate('mid', 'u', '2026-09-05T00:00:00.000Z'),
  ], 3, 3)
  check('the longest-waiting post goes first',
    ordered.map((o) => o.id).join(',') === 'old,mid,new', ordered.map((o) => o.id).join(','))

  check('an empty sweep is an empty list, not a crash',
    takeFairly([]).length === 0)
}

// ── the windows are sane ────────────────────────────────────────────────────
{
  check('WordPress gets first refusal on every scheduled post',
    GRACE_MINUTES >= 15,
    'a short grace races WP-Cron and risks publishing a post it was about to publish itself')
  check('and a post is not swept forever',
    MAX_AGE_DAYS > 0 && MAX_AGE_DAYS <= 60, String(MAX_AGE_DAYS))
  check('the per-creator cap is small enough not to flood a blog',
    MAX_PER_USER_PER_TICK <= 5, String(MAX_PER_USER_PER_TICK))
}

// ── it verifies rather than assumes ─────────────────────────────────────────
//
// The whole family of bugs this belongs to is MVP believing a request worked
// because it returned 200. The heal must not join it.
{
  // Asserted against the SELECT itself, not against the file. `schedule_mode`
  // also appears in the interface, so a looser match passed with the column
  // dropped from the query, which would have left the rule reading undefined
  // for every row and quietly refusing Eric's posts again.
  check('the mode is carried through the query, or the rule above cannot apply',
    /\.select\('[^']*schedule_mode[^']*'\)/.test(HEAL_LIVE)
      && /mayAutoPublish\(status, c\.schedule_mode\)/.test(HEAL_LIVE),
    'a rule that reads a field nothing selects is a rule that never fires')
  check('the sweep re-reads the status after publishing',
    /const after = await wp\.getPostStatuses\(\[c\.wordpress_post_id\]\)/.test(HEAL_LIVE)
      && /after\.get\(c\.wordpress_post_id\) !== 'publish'/.test(HEAL_LIVE),
    'a 200 from the PATCH is what MVP has been believing for months')
  check('a site it could not read is not treated as a site with nothing published',
    /if \(!statuses\) \{ out\.unreachable \+= group\.length; continue \}/.test(HEAL_LIVE))
  check('the stale future date is cleared with the status',
    /date: new Date\(\)\.toISOString\(\)/.test(HEAL_LIVE),
    'a live post still carrying a future date can be re-filed as scheduled, putting it straight back here')
  check('a post confirmed live leaves the sweep',
    /out\.confirmed\.push\(c\.id\)/.test(HEAL_LIVE) && /clearSchedule\(admin, c\.id\)/.test(HEAL_LIVE),
    'otherwise every published post costs a WordPress request every minute until it ages out')
  check('a post gone from WordPress leaves the sweep too',
    /wpStatus: 'missing'/.test(HEAL_LIVE))
  check('a skipped draft KEEPS its schedule so the creator keeps seeing it',
    /out\.skipped\.push\(\{ id: c\.id, wpStatus: status \}\)/.test(HEAL_LIVE),
    'clearing it would hide the one case a human still has to decide')
  check('bookkeeping failure never undoes a real publish',
    /the publish already happened; bookkeeping is not worth failing it/.test(HEAL))
}

// ── and it actually runs ────────────────────────────────────────────────────
{
  check('the cron calls it',
    /healMissedSchedules\(admin\)/.test(CRON))
  check('on quiet ticks as well as busy ones',
    (CRON.match(/healMissedSchedules\(admin\)/g) || []).length >= 2,
    'wp-native posts create no scheduled_posts row, so the quiet tick is exactly when one is sitting unpublished')
  check('the sweep never throws into the cron',
    /Promise<HealOutcome>/.test(HEAL_LIVE) && /catch \(e\) \{\n\s*out\.errors\.push/.test(HEAL_LIVE),
    'this cron also publishes social posts and must not go down with a WordPress wobble')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
