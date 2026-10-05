/**
 * ONE RE-ATTEMPT PER FAILED X POST, THEN DROPPED (Seb, 2026-10-05).
 *
 * X bills every request, failed ones included. Every path that posts to X goes
 * through postToXWithOneRetry, which sends at most two requests per post ever,
 * counted in ai_usage so the count survives a cron tick or a second click. The
 * scheduler never requeues an X post that already reached X.
 *
 * Run: npx tsx scripts/test-x-one-retry.ts
 */
import { readFileSync } from 'node:fs'
import { X_ATTEMPTS_PER_POST, xFailureWorthRetry, xMayHavePosted, xPostKey, xDroppedMessage } from '../lib/x-retry'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

check('a post gets two requests in total: the try and one re-attempt', X_ATTEMPTS_PER_POST === 2)
check('a network blip is worth the re-attempt', xFailureWorthRetry('fetch failed'))
check('a 5xx is worth the re-attempt', xFailureWorthRetry('Twitter tweet failed (503): Service Unavailable'))
check('a 401 is worth the re-attempt (after a token refresh)', xFailureWorthRetry('Twitter tweet failed (401): Unauthorized'))
check('duplicate text is not re-sent', !xFailureWorthRetry('Twitter tweet failed (403): You are not allowed to create a Tweet with duplicate content.'))
check('a malformed request is not re-sent', !xFailureWorthRetry('Twitter tweet failed (400): Invalid Request'))
check("X's daily limit is not re-sent", !xFailureWorthRetry("RATE_LIMIT: X's daily post limit is reached"))
check('a duplicate after a timeout says the first try may be live', xMayHavePosted('The operation timed out', 'Twitter tweet failed (403): duplicate content'))
check('a duplicate after a 400 does not', !xMayHavePosted('Twitter tweet failed (400): bad', 'Twitter tweet failed (403): duplicate content'))
check('each kind of post has its own key', xPostKey('blog', 'a') !== xPostKey('scheduled', 'a'))
check('the dropped message says it will not be sent again', /will not send it to X again/.test(xDroppedMessage()))

const H = read('lib/x-retry.ts')
check('the helper refuses a post that already failed twice, before reserving', H.indexOf('if (failures >= X_ATTEMPTS_PER_POST) throw new XPostError(xDroppedMessage(), false, true)') < H.indexOf('await reserveXPost('))
check('every failed request is refunded and counted', /await refundXPost\(o\.supabase, res\.reservationId\)[\s\S]{0,120}await markXAttemptFailed\(o\.userId, o\.key\)/.test(H))
check('the count rows cost nothing (images 0, unpriced model)', /feature: X_ATTEMPT_FAILED_FEATURE, model: key,\s*input_tokens: 0, output_tokens: 0, web_searches: 0, images: 0/.test(H))

const PATHS = ['app/api/cron/process-scheduled/route.ts', 'app/api/blog/twitter-post/route.ts', 'lib/deal-social-publish.ts']
for (const f of PATHS) {
  const s = read(f)
  check(`${f}: posts through postToXWithOneRetry`, /postToXWithOneRetry\(\{/.test(s))
  check(`${f}: no bare createTweet outside the helper`, (s.match(/createTweet\(/g) ?? []).length === (s.match(/return createTweet\(|tweet: \(\) => createTweet\(/g) ?? []).length)
  check(`${f}: checks the drop before the image upload`, s.indexOf('xFailedAttempts(') > 0 && s.indexOf('xFailedAttempts(') < s.lastIndexOf('resolveXMedia('))
}
check('a deal goes to X only on a plan that includes X', /if \(!tierAllowsSocial\(ig\.tier as Tier, 'twitter'\)\) throw new Error/.test(read('lib/deal-social-publish.ts')))
const C = read('app/api/cron/process-scheduled/route.ts')
check('the scheduler never requeues an X post that reached X or was dropped', /const xAlreadyRetried = err instanceof XPostError && \(err\.sent \|\| err\.dropped\)/.test(C) && /&& !xAlreadyRetried\) \{/.test(C))

if (failures.length) {
  console.error('❌ x-one-retry guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ x-one-retry guard passed (two requests per X post at most, on every path)')
