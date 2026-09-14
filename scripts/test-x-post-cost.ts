// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A failed X post still cost us $0.20, and the books have to say so.
//
// X bills per REQUEST, not per successful post. From the developer console
// (2026-09-14): 227 requests over 30 days against $45.41 of cost, which is
// $0.2000 each to four decimal places. The console's "Billable events" tile
// reads 0 over the same window, so that tile is not the meter that produces the
// invoice — the Requests chart is, and a createTweet that comes back 4xx or 5xx
// is one of those requests.
//
// refundXPost used to DELETE the reservation row. Two different things were
// riding on that one row:
//
//   the cap counter   should a failed post cost the creator a monthly slot? no
//   the cost record   did we pay X for it? yes
//
// Deleting served the first and lied about the second, so every failed X post
// vanished from cost reporting entirely. Worse, it vanished from the monthly
// spend circuit breaker, which means the one failure mode the breaker exists to
// catch — a loop retrying the same broken post — was the exact failure mode that
// registered as free.
//
// The fix re-labels rather than deletes. 'x_post_failed' is not in
// PRIMARY_FEATURE.x, so the creator gets their slot back, and the row keeps its
// model so the $0.20 stays on the books.
import { readFileSync } from 'node:fs'
import { PRICING, costOf } from '../lib/ai-usage'
import { PRIMARY_FEATURE } from '../lib/usage-cap'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const SRC = readFileSync('lib/x-cap.ts', 'utf8')

// ── the money is kept, not deleted ──────────────────────────────────────────
{
  check('a failed post does not erase its cost row',
    !/from\('ai_usage'\)\s*\.delete\(\)/.test(SRC),
    'deleting the reservation deleted the $0.20 we had already spent')
  check('it is re-labelled instead',
    /\.update\(\{ feature: 'x_post_failed' \}\)/.test(SRC),
    'the row is the only record that the request happened')
  check('and only a row it actually reserved is touched',
    /\.eq\('id', reservationId\)\.eq\('feature', 'x_post'\)/.test(SRC),
    'without the feature guard a re-label could hit an already-refunded row twice')
}

// ── the creator gets their slot back ────────────────────────────────────────
{
  check('the cap counts only successful posts',
    PRIMARY_FEATURE.x.includes('x_post') && !PRIMARY_FEATURE.x.includes('x_post_failed'),
    `cap features are ${JSON.stringify(PRIMARY_FEATURE.x)}; if x_post_failed is ever added here, a failure on our side starts costing the creator a slot again`)
}

// ── both rows price identically, because both were the same request ─────────
{
  const row = { model: 'twitter-api', images: 1, input_tokens: 0, output_tokens: 0, web_searches: 0 }
  check('an X request costs $0.20', costOf(row) === 0.20,
    `got $${costOf(row)}; this is the number the console's own math produces (227 requests, $45.41)`)
  check('and the price lives in PRICING, not in a comment',
    PRICING['twitter-api']?.imageCost === 0.20)
}

// ── the reservation still happens BEFORE the request ────────────────────────
//
// Recording on success alone is what hid this in the first place. Reserving up
// front means every attempt leaves a row, and the outcome decides its label.
{
  check('a slot is reserved before the tweet is sent', /export async function reserveXPost/.test(SRC))
  check('and the header no longer claims a per-post price',
    /bills per REQUEST, not per successful post/.test(SRC),
    'the old comment said "per-post cost", which is what made recording on success look right')
}

if (failures.length) {
  console.error(`\n❌ x-post-cost: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ x-post-cost: a failed X post gives the creator their slot back and still shows up as the $0.20 we paid for it')
