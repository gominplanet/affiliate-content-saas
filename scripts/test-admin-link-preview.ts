// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// An operator may LOOK at another creator's links. They may not change them.
//
// Fix all affiliate links is session-scoped: it acts on the signed-in creator's
// posts using the signed-in creator's WordPress credentials. Diagnosing a
// customer's broken links therefore meant asking the customer to click a button
// and read the result back, which is slow and depends on them being available.
//
// So there is now an admin preview: pass asUserId and get the same analysis
// against their posts. It is READ-ONLY BY CONSTRUCTION, not by carefulness. The
// route refuses the request outright unless dryRun is set, which makes the apply
// branch unreachable on that path. That distinction is the entire justification
// for building it, so it is asserted here rather than trusted.
//
// Source assertions, deliberately. What matters is the SHAPE of the guard: that
// the refusal comes before any work, that it is gated on admin, and that reading
// someone else's content is logged. A behavioural test would need a live session
// for two different accounts and would end up proving less.
import { readFileSync } from 'node:fs'

const ROUTE = readFileSync('app/api/blog/fix-affiliate-links/route.ts', 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the guard exists and refuses writes ─────────────────────────────────────
{
  check('the route accepts an asUserId', /asUserId/.test(ROUTE))

  // The refusal must be tied to dryRun. Anything else (a tier check alone, a
  // comment, an intention) leaves the apply branch reachable.
  check('a non-dryRun request for another user is refused',
    /if\s*\(!dryRun\)\s*\{[\s\S]{0,400}?preview_only/.test(ROUTE),
    'the read-only promise has to be enforced by the code, not by the caller behaving')

  check('and the refusal explains who can apply',
    /They apply the fix from their own account/.test(ROUTE))
}

// ── only an admin ───────────────────────────────────────────────────────────
{
  check('the operator must be admin',
    /normalizeTier\([\s\S]{0,80}?\)\s*!==\s*'admin'/.test(ROUTE),
    'without this any signed-in creator could read any other creator\'s posts')

  // The tier is read for the OPERATOR, from their own session client, not for
  // the subject and not through the service role. Checking the wrong row here
  // would let a non-admin pass by naming an admin as the subject.
  const guard = ROUTE.slice(ROUTE.indexOf('const asUserId'), ROUTE.indexOf('const asUserId') + 1600)
  check('the tier is read for the operator, via their own session',
    /supabase\s*\.from\('integrations'\)[\s\S]{0,120}?eq\('user_id',\s*user\.id\)/.test(guard),
    'reading the subject\'s tier instead would invert the check entirely')
}

// ── it actually reads the subject's data ────────────────────────────────────
{
  // RLS scopes the session client to the operator, so without the service role
  // the preview returns zero posts and reads as "nothing to fix" rather than
  // "you cannot see this". A wrong-looking success is worse than a refusal.
  const guard = ROUTE.slice(ROUTE.indexOf('const asUserId'), ROUTE.indexOf('const asUserId') + 1600)
  check('the service role is used for the subject\'s reads', /createAdminClient\(\)/.test(guard))
  check('and the acting identity switches to the subject', /actingUserId\s*=\s*asUserId/.test(guard))

  // The default must remain the signed-in creator. A default that fell through
  // to the service role would silently drop RLS for every ordinary request.
  check('the default identity is still the signed-in creator',
    /let\s+actingUserId\s*=\s*user\.id/.test(ROUTE))
  check('the default client is still the session client',
    /let\s+db:\s*any\s*=\s*supabase/.test(ROUTE))
}

// ── reading someone else's content leaves a trace ───────────────────────────
{
  check('an admin preview is logged with both identities',
    /console\.(warn|log)\([^)]*admin preview[\s\S]{0,120}?operator[\s\S]{0,60}?subject/.test(ROUTE),
    'support access to a customer\'s content should be visible after the fact')
}

// ── every read after the guard uses the acting client ───────────────────────
//
// The first run of this preview reported "0 posts would be re-pointed" for an
// account with 113 posts needing exactly that. The scan query still used the
// session client, which RLS scopes to the OPERATOR, against a user_id belonging
// to the subject: it matched nothing. Five queries had it, all missed by a
// rename because `.from(` sat on the next line.
//
// A read on the wrong client does not error. It returns an empty set, and an
// empty set reads as a healthy account.
{
  const guardAt = ROUTE.indexOf('const asUserId')
  const body = ROUTE.slice(guardAt)
  const strays: string[] = []
  body.split('\n').forEach((line, i) => {
    const usesSession = /await\s+supabase\b/.test(line) || /await\s+\(supabase as/.test(line)
    // The operator's OWN row is the one legitimate session-client read here:
    // the tier check has to run as the signed-in person, not as the subject.
    // It is identified by reading user.id on the same statement.
    const isOperatorsOwnRow = /user\.id/.test(line)
    if (usesSession && !isOperatorsOwnRow) {
      strays.push(`line ${i + 1}: ${line.trim().slice(0, 80)}`)
    }
  })
  check('no session-client reads survive the acting-identity switch',
    strays.length === 0,
    strays.length ? `${strays.length} left, e.g. ${strays[0]}. Use \`db\`, which is the session client normally and the service role during an admin preview.` : undefined)

  // The detector has to be able to find one, or it passes by looking nowhere.
  check('the stray detector works',
    /await\s+supabase\b/.test('  const { data } = await supabase'),
    'if this fails the check above proves nothing')
}

if (failures.length) {
  console.error(`\n❌ admin-link-preview: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ admin-link-preview: an operator can look at another creator\'s links and cannot write them')
