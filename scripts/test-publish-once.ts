// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A RETRY RESUMES A PUBLISH. IT DOES NOT REPEAT ONE.
//
// A creator reported three near-identical posts on his site, two days running,
// published a minute apart. The obvious reading was a duplicate job, and it was
// wrong. His database settled it:
//
//   WordPress   3 posts on 09-09, 3 on 09-10, at :04, :05 and :06
//   blog_posts  ONE row for each day
//
// One row and three posts is not two jobs. It is ONE job, retried. max_attempts
// is 3, the worker ticks once a minute, and the job checkpointed the writer
// output BEFORE the WordPress publish so a retry would not re-pay for Opus.
// Nothing was written AFTER the publish. So an attempt that published
// successfully and then died on the way home — the worker's abort, a failed
// blog_posts insert — was requeued, resumed from the checkpoint, and created a
// SECOND post. Then a third. The single surviving row is exactly why nothing
// downstream ever noticed: every count, every cap and every dashboard read one.
//
// The route already had the concept. `existingWpPostId` means "update this post
// instead of creating one", and it was only ever populated from
// blog_posts.wordpress_post_id — a row that, on this path, does not exist yet.
// It was blind in the one case that needed it.
//
// So the WordPress post id goes into the checkpoint the instant WordPress
// accepts it, and a resume reads it. Checked on the source because the ORDER is
// the whole property: recorded after the publish, read before it.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const RAW = readFileSync('app/api/blog/generate/route.ts', 'utf8')
// Comment blocks first. The explanation above is repeated in the route and
// quotes the bug it replaced, so a grep over raw source finds the note and
// calls it the defect. This has now caught its own comments in four guards.
const SRC = RAW
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const JOBS = readFileSync('lib/generation-jobs.ts', 'utf8')

// ── the id is recorded, and recorded in time ───────────────────────────────
{
  check('the WP post id is written to the checkpoint', /__wpPostId: wpPost\.id/.test(SRC),
    'without it a retry has no way to know this job already published')

  const atCreate = SRC.indexOf('wpPost = await wpService.createPost(')
  const atSave = SRC.indexOf('__wpPostId: wpPost.id')
  check('createPost is still there to be guarded', atCreate !== -1)
  check('and the id is saved AFTER the post exists', atCreate !== -1 && atSave > atCreate,
    'saving before the call would record an id WordPress never issued')

  // Everything between the publish and the blog_posts insert is a chance for
  // the attempt to die. The gap is the bug; it has to stay small.
  const between = SRC.slice(atCreate, atSave)
  check('with nothing between the publish and the record',
    !/from\('blog_posts'\)[\s\S]{0,80}(insert|upsert)/.test(between),
    'if the row is written first, the window this closes is open again')
}

// ── and a resume uses it INSTEAD of publishing again ───────────────────────
{
  check('a resume reads the checkpointed id', /const priorWpId = \(checkpointGen as/.test(SRC))
  check('and routes it into the update path', /existingWpPostId = priorWpId/.test(SRC),
    'existingWpPostId is what makes the route update instead of create; anything else still makes a post')
  check('it does not override a real row', /&& !existingWpPostId/.test(SRC),
    'blog_posts.wordpress_post_id is the better answer when it exists')
  check('and a junk value is ignored', /typeof priorWpId === 'number' && priorWpId > 0/.test(SRC),
    'a null or a 0 handed to updatePost is a request to edit a post that is not there')

  const atRead = SRC.indexOf('existingWpPostId = priorWpId')
  const atCreate = SRC.indexOf('wpPost = await wpService.createPost(')
  check('the resume happens BEFORE the publish decision', atRead !== -1 && atRead < atCreate,
    'read after the create, it would record the duplicate rather than prevent it')
}

// ── the retry budget that makes this matter is still real ──────────────────
//
// Stated rather than assumed: if max_attempts became 1 this whole class would
// vanish and the checks above would be guarding nothing. It is 3.
{
  check('a job still retries', /max_attempts: args\.maxAttempts \?\? 3/.test(JOBS),
    'three attempts is why one failure after a successful publish became three posts')
  check('and the checkpoint is still written before the publish', /BEFORE the slow WordPress publish|BEFORE the WP publish/.test(JOBS),
    'that ordering is what makes a resume cheap, and what made it dangerous')
}

// ── AND THE SAME THING IN THE CAMPAIGN ROUTE ───────────────────────────────
//
// Found by asking "can this still happen by our fault", which is a different
// question from "is the reported bug fixed". The campaign route publishes to
// WordPress at one point and marks its row `published` about 130 lines later,
// after three image uploads against the creator's own host. Anything that dies
// in that stretch leaves a live post and a row that does not know.
//
// An automatic retry is blocked: the status claim only accepts pending/failed/
// queued and a dead run leaves the row at `researching`. But
// reset-stuck-campaigns flips `researching` to `failed` after 10 minutes, a
// `failed` row IS claimable, and the creator is shown a Retry button. So the
// product invited the duplicate instead of looping into it.
{
  const CAMP = readFileSync('app/api/campaigns/generate/route.ts', 'utf8')
  const camp = CAMP
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  check('the campaign route records the WP post id', /wordpress_post_id: wpPost\.id/.test(camp),
    'without it a Retry on a campaign that already published makes a second post')

  const atPublish = camp.search(/wpPost = existingWpPostId/)
  const atStamp = camp.indexOf('wordpress_post_id: wpPost.id')
  check('and records it AFTER the post exists', atPublish !== -1 && atStamp > atPublish)

  // The gap is the whole defect. Nothing slow may sit between the publish and
  // the write that records it.
  const between = camp.slice(atPublish, atStamp)
  check('with no image upload between the publish and the record',
    !/uploadImageFrom(Url|Base64)/.test(between),
    'each upload is a slow call to the creator\'s host, and each one is a chance to die holding an unrecorded post')

  check('a re-run updates instead of creating', /await wpService\.updatePost\(existingWpPostId, payload\)/.test(camp),
    'createPost on a campaign that already published is the duplicate')
  check('and the id comes from the claimed row', /const prior = Number\(r\.wordpress_post_id\)/.test(camp))
  check('and a junk value is ignored', /Number\.isFinite\(prior\) && prior > 0/.test(camp),
    'a 0 or a NaN handed to updatePost edits a post that is not there')

  // The claim must not name the new column, or the whole route dies on any
  // deployment where the migration has not run yet.
  // Anchored to the CLAIM, not to any select in the file. The first version of
  // this check matched a select('*') elsewhere in the route, so pointing the
  // claim at a named column list passed cleanly.
  const atClaim = camp.indexOf("    .in('status', ['pending', 'failed', 'queued'])")
  const afterClaim = atClaim === -1 ? '' : camp.slice(atClaim, atClaim + 400)
  check('the claim itself is still in the file', atClaim !== -1,
    'if the status claim moved, the protection it provides moved with it')
  check("the claim reads the row with select('*')", /\.select\(\s*'\*'\s*\)/.test(afterClaim),
    'PostgREST rejects the entire statement over one unknown column, so naming wordpress_post_id here stops campaign generation for everyone until the migration runs')
  check('and the stamp survives the column being absent', /schema cache/.test(camp),
    'between the deploy and the migration the write must degrade, not throw away wordpress_url with it')

  check('the migration exists', (() => {
    try { return readFileSync('supabase/migrations/338_campaigns_wordpress_post_id.sql', 'utf8').includes('add column if not exists wordpress_post_id') } catch { return false }
  })(), 'the code above does nothing until the column is there')
}

if (failures.length) {
  console.error(`\n❌ publish-once: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ publish-once: a retried job updates the post it already published instead of creating another')
