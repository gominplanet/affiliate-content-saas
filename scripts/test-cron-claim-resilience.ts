// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A queue must not be stoppable by the shape of its own claim.
//
// Production, 2026-09-14 10:07 GMT-4, /api/cron/process-burn-jobs:
//
//   PATCH  -> 400 in 55ms
//   route  -> 500 in 64ms
//
// repeating on the schedule, every queued Shop Burner job stuck behind it, and
// nobody watching because a cron has no user.
//
// THE CAUSE WAS .order() ON THE MUTATION. PostgREST does not accept an order on
// a PATCH. The two sibling queues (process-amazon-schedules,
// process-deal-schedules) have always worked and the only thing separating them
// was that they never ordered their claim.
//
// Worth recording how this was nearly misdiagnosed, because the wrong answer
// was extremely plausible: the claim also named seven columns, PostgREST DOES
// reject a whole statement over one missing column, and the comment above the
// claim showed that exact trap had been hit there before. Every sign pointed at
// a missing column. The schema then showed all seven present, and the real
// difference was one line nobody had looked at. A 400 has more than one cause
// and the error body is the only thing that distinguishes them.
//
// So this file pins BOTH rules:
//
//   no order on a claim   the bug that actually happened
//   no column list        the bug that nearly happened, and still could
//
// Order on the READ is fine and is how you keep oldest-first: read the id,
// then claim by id. process-burn-jobs and prerender-pins both do that now.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const CRON_DIR = 'app/api/cron'
const routes = readdirSync(CRON_DIR)
  .map(d => join(CRON_DIR, d, 'route.ts'))
  .filter(p => existsSync(p))

check('there are cron routes to check', routes.length > 10, `${routes.length} found`)

// ── no claim names its columns ──────────────────────────────────────────────
//
// A "claim" is .update(...) whose result is read back with .select(...). That is
// the pattern that turns a missing column into a stopped queue.
for (const file of routes) {
  const src = readFileSync(file, 'utf8')
  // .update({...}) ... .select('…') within the same chain. The gap allows the
  // .eq/.lte/.in filters that sit between them.
  for (const m of src.matchAll(/\.update\(\{[\s\S]{0,400}?\}\)((?:[^;]|\n){0,400}?)\.select\('([^']*)'\)/g)) {
    // The gap must stay inside ONE chain. A `.from(` in it means the regex has
    // run past the update into a later read on a different table, which is a
    // different statement and not a claim.
    if (/\.from\(/.test(m[1])) continue
    const cols = m[2].trim()
    // 'id' is safe: the primary key cannot be the column somebody forgot to add.
    if (cols !== '*' && cols !== 'id') {
      check(`${file} claims with select('*')`, false,
        `selects "${cols}" — one unapplied migration on any of those 400s the claim and halts this queue for good`)
    }
    // THE ONE THAT ACTUALLY HAPPENED. PostgREST does not accept an order on a
    // mutation. Order the READ that finds the row, then claim it by id.
    const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 160)
    check(`${file} does not order its claim`,
      !/^\s*\.order\(/.test(tail),
      'PostgREST rejects an order on a PATCH; this 400s every tick and the queue never claims anything again')
  }
}

// ── and the burn queue specifically says something when it cannot claim ──────
//
// Returning a bare 500 on a cron is indistinguishable from silence: the only
// place it appears is Vercel logs, which is where this one hid for a day.
{
  const BURN = readFileSync('app/api/cron/process-burn-jobs/route.ts', 'utf8')
  check('the burn queue reads the oldest id first',
    /\.select\('id'\)[\s\S]{0,200}?\.order\('scheduled_at', \{ ascending: true \}\)/.test(BURN),
    'ordering is allowed on a read and is the only way to keep oldest-first')
  check('and then claims that one id',
    /\.eq\('id', dueId\)[\s\S]{0,80}?\.eq\('status', 'pending'\)/.test(BURN),
    'the status guard on the claim is what keeps two overlapping ticks off the same row')
  check('a failed claim pages ops', /alertOps\(/.test(BURN),
    'a cron that 500s on a schedule tells nobody by default, which is how this hid for a day')
  check('and the alert carries the raw message',
    /ig_burn_jobs claim failed: \$\{claimErr\.message\}/.test(BURN),
    'the first diagnosis of this outage was wrong because the PostgREST message was never in front of anybody')
}

if (failures.length) {
  console.error(`\n❌ cron-claim-resilience: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cron-claim-resilience: no claim orders a mutation, none names its columns, and a claim that fails says so out loud')
