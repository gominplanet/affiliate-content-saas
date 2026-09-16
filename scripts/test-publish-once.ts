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

if (failures.length) {
  console.error(`\n❌ publish-once: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ publish-once: a retried job updates the post it already published instead of creating another')
