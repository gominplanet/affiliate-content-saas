// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE POST THAT WAS NEVER PUBLISHED AND NEVER REPORTED.
//
// 17 Sep 2026, from a creator on Hostinger:
//
//   "Nada. Nothing was posted. I decided to check WP Admin through Hostinger,
//    and I can see that the posts are being saved as drafts. They never publish,
//    and they also disappear from the schedule in MVP."
//
// He had to log into his host to find out what his own dashboard would not tell
// him, and every screen he could reach in MVP said everything was fine.
//
// TWO FAULTS, one cause. Most MVP posts are scheduled "wp-native": created with
// status=future and a date, left for WordPress's own cron to publish. WP-Cron
// only fires when somebody loads the site, so a new blog with no traffic never
// runs it and the post sits unpublished. WordPress calls that a missed schedule.
//
//   1. blog/generate writes status='published' for a scheduled post and says
//      why: "the 'is it live yet?' question is answered by scheduled_for being
//      in the past". That is an assumption and WP-Cron falsifies it routinely.
//   2. The schedule list synthesised its rows from `scheduled_for > now`, so a
//      post vanished from the schedule the moment its time passed — whether or
//      not anything had published it.
//
// Together: the schedule empties, the Library says published, and the post is
// still a draft. Nothing anywhere is wrong on screen, and nothing is right.
//
// The fix is to ASK WordPress instead of assuming, and this file pins the
// asking, the reporting and the button beside it.
//
// AND THE BANNER THAT CALLED A SUCCESS A FAILURE. The same creator saved his
// Brand Profile and was shown "Saved here, but the WordPress push failed" above
// the words "Geniuslink accepted your key. 82 link groups found." One state
// variable was written by three unrelated steps and rendered under one
// hardcoded headline, so the Geniuslink success sat under a WordPress failure.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIST = read('app/api/blog/scheduled-list/route.ts')
const LIST_LIVE = live(LIST)
const WP = live(read('services/wordpress/index.ts'))
const PUBLISH_NOW = read('app/api/blog/publish-now/route.ts')
const PUBLISH_NOW_LIVE = live(PUBLISH_NOW)
const CONTENT = read('app/(dashboard)/content/page.tsx')
const CONTENT_LIVE = live(CONTENT)
const BRAND = read('app/(dashboard)/brand/page.tsx')
const BRAND_LIVE = live(BRAND)

// ── we ask WordPress rather than assuming ───────────────────────────────────
{
  check('there is a way to read what WordPress says a post\'s status is',
    /async getPostStatuses\(ids: number\[\]\)/.test(WP))
  check('and it asks for every status, not just published ones',
    /status=any/.test(WP),
    'the REST default returns published posts only, which would report every missed schedule as simply absent')
  check('a failed request is null, never an empty answer',
    /return null\n\s*\}\n\s*\}/.test(WP) && /Map<number, string> \| null/.test(WP),
    '"I could not ask" and "none of them published" collapsing into one answer is the original bug')
  check('the schedule list uses it',
    /getPostStatuses\(/.test(LIST_LIVE))
  check('and skips a site it could not reach instead of accusing it',
    /if \(!statuses\) continue/.test(LIST_LIVE),
    'reporting every post as unpublished on a network wobble is the same failure pointing the other way')
}

// ── an overdue post is reported, not dropped ────────────────────────────────
{
  check('posts whose time has passed are looked up at all',
    /\.lt\('scheduled_for', nowIso\)/.test(LIST_LIVE),
    'the list only ever queried scheduled_for > now, which is why they vanished')
  check('the search is bounded rather than unlimited',
    /OVERDUE_WINDOW_DAYS/.test(LIST_LIVE),
    'each sweep costs a WordPress request per site')
  check('a post WordPress has actually published is not reported',
    /if \(!status \|\| status === 'publish'\) continue/.test(LIST_LIVE))
  check('a post deleted in WP admin is not called a missed schedule',
    /!status \|\|/.test(LIST_LIVE),
    'absent from the answer is a different situation and needs a different message')
  check('the row carries the status WordPress actually reports',
    /wpStatus: status/.test(LIST_LIVE),
    'so the screen can say what is true rather than a guess')
  check('the list still loads if the check fails',
    /overdue check failed \(non-fatal\)/.test(LIST),
    'the posts stay unpublished either way; only the warning would be lost')
}

// ── the screen says so, in its own words ────────────────────────────────────
{
  check('overdue is its own status in the UI, not folded into pending or failed',
    /'pending' \| 'processing' \| 'completed' \| 'failed' \| 'cancelled' \| 'overdue'/.test(CONTENT_LIVE))
  check('and has its own label',
    /overdue:\s*\{ label: 'Not published yet'/.test(CONTENT_LIVE),
    '"Pending" would be false since the time has passed, and "Failed" would be false since nothing failed')
  check('it survives the history filter',
    /i\.status === 'overdue'/.test(CONTENT_LIVE),
    'hiding it as history is how it was invisible in the first place')
  check('and sorts above everything else',
    /st === 'overdue' \? 0/.test(CONTENT_LIVE),
    'a post that should already be live outranks one still waiting its turn')
  check('the explanation names WP-Cron in plain words',
    /WordPress only publishes scheduled posts when someone visits your site/.test(LIST),
    'a creator who does not know this reads the situation as MVP being broken')
}

// ── and gives him the button ────────────────────────────────────────────────
{
  check('there is a publish-now action on the row',
    /Publish it now/.test(CONTENT),
    'naming the problem without the fix is what sent him into WP Admin through his host')
  check('it posts to a route of its own',
    /\/api\/blog\/publish-now/.test(CONTENT_LIVE) && PUBLISH_NOW.length > 0)
  check('the route is scoped to the creator\'s own posts',
    /\.eq\('user_id', user\.id\)/.test(PUBLISH_NOW_LIVE),
    'publishing is a write to somebody\'s live website')
  check('it clears the stale future date along with the status',
    /date: new Date\(\)\.toISOString\(\)/.test(PUBLISH_NOW_LIVE),
    'a published post still carrying a future date can be re-filed as scheduled')
  check('and VERIFIES with WordPress before claiming success',
    /getPostStatuses\(\[post\.wordpress_post_id\]\)/.test(PUBLISH_NOW_LIVE)
      && /nowStatus !== 'publish'/.test(PUBLISH_NOW_LIVE),
    'assuming a 200 means published is the exact bug this route cleans up after')
  check('a post gone from WordPress is named as gone, not retried forever',
    /isStalePostError\(err\)/.test(PUBLISH_NOW_LIVE))
  check('the post stops being reported as overdue once it is live',
    /scheduled_for: null/.test(PUBLISH_NOW_LIVE))
  check('and a missing migration cannot turn a successful publish into an error',
    /column .\* does not exist/.test(PUBLISH_NOW_LIVE),
    'PostgREST rejects the whole statement when one named column is absent')
}

// ── the brand banner states what happened ───────────────────────────────────
{
  check('notices carry their own headline instead of sharing one',
    /notices, setNotices\] = useState<Array<\{ tone: 'ok' \| 'warn' \| 'error'; title: string; detail: string \}>>/.test(BRAND_LIVE),
    'one slot cannot carry a headline, because the headline belongs to the event')
  check('the single overloaded note is gone',
    !/setWpPushNote\(/.test(BRAND_LIVE),
    'three unrelated steps wrote to it and one hardcoded headline described all of them')
  check('a Geniuslink success is reported as a success',
    /addNotice\('ok', 'Geniuslink connected'/.test(BRAND_LIVE),
    'this exact message was displayed under "the WordPress push failed"')
  check('a Geniuslink rejection is reported as an error, and named',
    /addNotice\('error', 'Geniuslink rejected your key'/.test(BRAND_LIVE))
  check('the WordPress failure keeps its own headline',
    /addNotice\('error', 'Saved here, but the WordPress push failed'/.test(BRAND_LIVE))
  check('and that headline is no longer hardcoded above whatever happened last',
    !/mb-0\.5">Saved here, but the WordPress push failed<\/p>/.test(BRAND),
    'the static headline is what made a success read as a failure')
  check('a successful WordPress push still says nothing',
    /json\.wordpress === 'pushed'/.test(BRAND_LIVE),
    'silence on success is right; it was the leftover note underneath it that lied')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
