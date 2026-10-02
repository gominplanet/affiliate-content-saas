// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CREATOR'S POSTS ARE REPAIRED ON OUR SIDE, NEVER AT HIS COST.
//
// Posts made from a creator's own videos while their transcript could not be
// read came out as research ("researched from the product listing..., not a
// first-hand test"). The admin repair rebuilds them in place, on our cost, not
// counted as his rebuilds, and only with a transcript (lib/post-repair,
// app/api/admin/rebuild-posts).
import { readFileSync } from 'node:fs'
import { researchSignals, repairReasons, hasUsableTranscript } from '../lib/post-repair'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const ROUTE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
const ADMIN = readFileSync('app/api/admin/rebuild-posts/route.ts', 'utf8')

// What the customer's posts actually said.
check('the listing line is found',
  researchSignals('<p>How this post was made: researched from the product listing, its specifications and the questions buyers ask.</p>').length === 1)
check('the "not a first-hand test" line is found',
  researchSignals('<p>Researched from the product listing and its specifications, not a first-hand test.</p>').length >= 1)
check('a denial of use is found',
  researchSignals('<p>I didn&#8217;t actually test this one.</p>').length === 1 || researchSignals("<p>I didn't actually test this one.</p>").length === 1)
check('a real step in a review is not a denial',
  researchSignals("<p>I didn't use a pencil to mark the holes.</p>").length === 0)
check('a post written from the video looks fine',
  repairReasons({ hasTranscript: true, signals: [] }).length === 0)
check('no transcript is a reason',
  repairReasons({ hasTranscript: false, signals: [] }).length === 1)
check('word cues count as a transcript',
  hasUsableTranscript(null, [{ text: 'a'.repeat(50) }, { text: 'b'.repeat(40) }]) && !hasUsableTranscript('', []))

// The route.
check('repair is honoured only on the job worker\'s service call',
  /const isRepair = isServiceCall && \(body as \{ repair\?: unknown \}\)\.repair === true/.test(ROUTE))
check('a repair never creates a post',
  /if \(isRepair && !existingForLimit\?\.wordpress_post_id\)/.test(ROUTE))
check('a repair without a transcript stops before writing',
  /if \(isRepair && !transcriptUsed\)[\s\S]{0,400}repair_no_transcript/.test(ROUTE))
check('a repair does not use up one of the creator\'s rebuilds',
  /\.\.\.\(isRewrite && !isRepair\s*\n?\s*\?/.test(ROUTE))
check('the transcription cost is billed to whoever ran it',
  /feature: 'blog_transcribe'/.test(ROUTE) && /recordUsage\(\{ userId: user\.id,[^\n]*'blog_transcribe'/.test(ROUTE))

// The admin route.
check('jobs are queued under the admin, for the creator',
  /userId: adminId, ownerId: userId, kind: 'blog', maxAttempts: 1/.test(ADMIN))
check('jobs ask for no social posts',
  !/autoSocials/.test(ADMIN.replace(/\/\/[^\n]*/g, '')))
check('only the creator\'s own live video posts are queued',
  /\.eq\('user_id', userId\)\.in\('video_id', videoIds\)\.not\('wordpress_post_id', 'is', null\)/.test(ADMIN))
check('the admin route is admin only',
  /tier !== 'admin'/.test(ADMIN))

if (failures.length) {
  console.error(`❌ post repair: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ post repair: repaired in place, on our cost, only from the video')
