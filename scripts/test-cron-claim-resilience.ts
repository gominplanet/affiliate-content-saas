// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A queue must not be haltable by one unapplied migration.
//
// PostgREST rejects the ENTIRE statement with a 400 when one named column is
// missing. That is survivable on a read — you lose one panel. It is not
// survivable on the atomic UPDATE...RETURNING that claims the next job, because
// that statement IS the queue: it 400s, the route 500s, and nothing is ever
// claimed again. Silently, because a cron has no user watching it.
//
// Observed in production 2026-09-14 at 10:07 GMT-4 on /api/cron/process-burn-jobs:
//
//   PATCH  → 400 in 55ms
//   route  → 500 in 64ms
//
// repeating on the schedule, with every queued Shop Burner job stuck behind it.
//
// The claim had named seven columns. The comment above it showed the same trap
// had ALREADY been hit once, for sticker_url (migration 139) and
// sticker_duration_sec (174), and had been fixed by deleting those two names
// from the list. That fixed the two columns that had broken and left the other
// seven loaded, which is how the same bug arrived twice.
//
// The durable rule: a claim selects '*'. A star select cannot be broken by the
// next column anybody adds.
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
    if (cols === '*' || cols === 'id') continue
    check(`${file} claims with select('*')`, false,
      `selects "${cols}" — one unapplied migration on any of those 400s the claim and halts this queue for good`)
  }
}

// ── and the burn queue specifically says something when it cannot claim ──────
//
// Returning a bare 500 on a cron is indistinguishable from silence: the only
// place it appears is Vercel logs, which is where this one hid for a day.
{
  const BURN = readFileSync('app/api/cron/process-burn-jobs/route.ts', 'utf8')
  check('the burn claim selects everything', /\.select\('\*'\)\s*\n\s*\.order\('scheduled_at'/.test(BURN),
    'the claim is the queue; naming columns there is what stopped it')
  check('a failed claim pages ops', /alertOps\(/.test(BURN),
    'a cron that 500s on a schedule tells nobody by default')
  check('and a schema fault is named as one',
    /schemaFault = \/column\|schema cache\|PGRST2/.test(BURN),
    '"Claim failed: ..." reads as a transient blip; "a column is missing and the queue is stuck" reads as an action')
}

if (failures.length) {
  console.error(`\n❌ cron-claim-resilience: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cron-claim-resilience: no queue can be halted by one unapplied migration, and a claim that fails says so out loud')
