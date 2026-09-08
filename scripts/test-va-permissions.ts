// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The permissions screen may not claim more than the code enforces.
//
// The invite form offers six toggles with specific promises: generate blog
// posts, publish to socials, manage newsletter, YouTube Co-Pilot, manage video
// library, view analytics. They are stored on the invite, carried onto the
// membership row, and displayed back on the team page.
//
// Exactly one of them is read anywhere: manage_newsletter, through
// denyNewsletterWrite. The other five keys appear nowhere in the codebase
// outside the file that defines them, and hasPermission and
// resolveAgencyContext are exported with no API route calling either.
//
// That is the shape of failure this repo keeps finding: a control that reports
// the plan rather than the result. An owner unticks "Publish to socials",
// believes their brand accounts are protected, and nothing changed. Worse than
// no toggle, because a missing control makes someone cautious and a broken one
// makes them relax.
//
// The page now says which are enforced. This test keeps the claim and the code
// tied together, in BOTH directions: if a permission is wired up later, the
// notice must stop calling it unenforced, and if the notice is deleted the
// toggles must have become real first.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VA_PERMISSION_KEYS } from '../lib/agency-permissions'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (['node_modules', '.next', '.git'].includes(e)) continue
    const f = join(d, e)
    if (statSync(f).isDirectory()) walk(f)
    else if (/\.tsx?$/.test(e)) files.push(f)
  }
}
for (const d of ['app', 'lib', 'components']) walk(join(root, d))

const PAGE = readFileSync(join(root, 'app/(dashboard)/agency/page.tsx'), 'utf8')

/** Which permission keys are actually read somewhere that can deny an action.
 *  The file that defines them and the page that renders them do not count. */
function enforcedKeys(): Set<string> {
  const enforced = new Set<string>()
  for (const f of files) {
    const rel = f.replace(root, '')
    if (rel.includes('agency-permissions.ts')) continue     // the definitions
    if (rel.includes('(dashboard)/agency/page.tsx')) continue // the UI
    const src = readFileSync(f, 'utf8')
    for (const key of VA_PERMISSION_KEYS) {
      // A quoted key passed to a permission check, e.g. hasPermission(ctx, 'x').
      if (new RegExp(`hasPermission\\([^)]*['"]${key}['"]`).test(src)) enforced.add(key)
    }
  }
  return enforced
}

// ── what is actually enforced ───────────────────────────────────────────────
{
  const enforced = enforcedKeys()

  check('manage_newsletter is enforced', enforced.has('manage_newsletter'),
    'denyNewsletterWrite is the one real gate; if it goes, the page must stop saying so')

  // The page names manage_newsletter as the enforced one. If another permission
  // becomes real, this fails and the notice needs updating to match.
  const unenforced = VA_PERMISSION_KEYS.filter(k => !enforced.has(k))
  check('the page still describes the right number as unenforced',
    new RegExp(`other ${['zero','one','two','three','four','five','six'][unenforced.length]} are`, 'i').test(PAGE)
      || unenforced.length === 0,
    `${unenforced.length} permissions are unenforced (${unenforced.join(', ')}), but the page's notice does not say that number`)
}

// ── the page has to be honest about it ──────────────────────────────────────
{
  check('the page tells the owner what the toggles do today',
    /What these permissions do today/.test(PAGE),
    'six switches that look equally real, one of which works, is the bug')
  // [\s\S] rather than the /s flag, which this tsconfig's target rejects.
  check('and names the one that is enforced', /Manage newsletter[\s\S]{0,40}enforced/i.test(PAGE))
  // Whitespace-tolerant: this copy is JSX and wraps across lines.
  check('and does not call the rest a lock',
    /rather\s+than\s+a\s+lock|not\s+a\s+lock/i.test(PAGE))
}

// ── no claim that outruns the code ──────────────────────────────────────────
// The banner used to say "Phase 2 live, full workspace sharing" including
// Geniuslink tracking, while the file header two screens above said Phase 1 and
// that VAs inherit nothing. Both could not be true, and the credential half was
// the one that mattered.
{
  check('the page no longer claims VAs get the credential row',
    !/Geniuslink tracking/.test(PAGE),
    'integrations is owner-only since migration 320')
  check('and says the API keys are not readable', /no longer read your stored API keys/.test(PAGE))
  check('the marketing copy does not promise scoped enforcement',
    !/scoped permissions/i.test(PAGE),
    'promising "only the access you explicitly grant" is the claim that is not yet true')
}

// ── the credential row stays out of VA sharing ──────────────────────────────
{
  const mig = readFileSync(join(root, 'supabase/migrations/320_va_integrations_no_credentials.sql'), 'utf8')
  check('migration 320 drops the widened policy', /drop policy if exists "VAs see owner integrations"/.test(mig))
  check('and leaves an owner-only read in place', /user_id = auth\.uid\(\)/.test(mig))
  check('it is safe to run twice', /drop policy if exists "Users see own integrations"/.test(mig),
    'without the guard, a re-run errors after the drop and leaves the table with no SELECT policy')

  // Routes that legitimately need the owner's credentials must use the service
  // role now, or they break for VAs.
  for (const f of ['app/api/geniuslink/test/route.ts', 'app/api/geniuslink/setup/route.ts']) {
    const src = readFileSync(join(root, f), 'utf8')
    check(`${f} reads the owner row with the service role`, /createAdminClient\(\)[\s\S]{0,80}from\('integrations'\)/.test(src),
      'the session client can no longer read the owner row, so a VA would get nothing')
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
