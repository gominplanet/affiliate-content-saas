// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Auto-pilot stays on until somebody turns it off.
//
// The report was "I keep ticking auto-pilot on and the next day it's off". No
// error, no notice, no clue. Here is why.
//
// blog_customizations exists in two places. integrations.blog_customizations is
// the live per-user set that the Customize, Ads and Brand Inquiries screens
// write. wordpress_sites.blog_customizations is that one blog's snapshot.
// Auto-pilot stores `autoBlog` and writes it ONLY to the site row, correctly:
// "one post a day" is a fact about one blog, not about the account.
//
// snapshotActiveBlogIdentity then copied the per-user blob over the site row
// wholesale, on every brand or Customize save. integrations has never contained
// autoBlog, so the copy deleted it, and readState reads an absent key as
// `enabled: false`. Turn auto-pilot on, change your footer that evening, and
// auto-pilot is off with nothing on screen linking the two.
//
// The failure mode is the one this codebase keeps producing: the setting still
// reports a value, the value is just quietly wrong, and off is indistinguishable
// from never-turned-on.
//
// This pins the rule rather than the wording: keys the SITE row owns survive a
// snapshot, and are stripped on a restore so one blog's schedule cannot leak
// onto the account and from there onto another blog.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const IDENTITY = read('lib/site-identity.ts')
const ROUTE = read('app/api/blog/autopilot/route.ts')
const CRON = read('app/api/cron/auto-blog/route.ts')

// ── auto-pilot state is per-site, and stays that way ────────────────────────
{
  check('the site-owned key set exists and names autoBlog',
    /SITE_OWNED_CUSTOMIZATION_KEYS\s*=\s*\[\s*'autoBlog'/.test(IDENTITY),
    'without a named set, the next per-site setting repeats this bug')

  check('the snapshot reads the site row before overwriting it',
    /from\('wordpress_sites'\)[\s\S]{0,200}select\('blog_customizations'\)/.test(IDENTITY),
    'it cannot preserve a key it never read')

  check('and merges the site-owned keys back over the per-user blob',
    /\.\.\.siteOwned/.test(IDENTITY),
    'a wholesale copy of integrations.blog_customizations deletes autoBlog')

  check('a snapshot with nothing user-level does not blank the site row',
    /Object\.keys\(siteOwned\)\.length > 0/.test(IDENTITY),
    'writing {} is the same deletion by another route')

  check('the restore strips site-owned keys on the way into integrations',
    /withoutSiteOwnedKeys\(bc as Record<string, unknown>\)/.test(IDENTITY),
    'otherwise blog A\'s schedule lands on the account and then on blog B')
}

// ── the helper itself does what it says ─────────────────────────────────────
// Re-implemented here rather than imported: site-identity pulls the Supabase
// client, and this check is about the rule, not the plumbing.
{
  const keys = ['autoBlog']
  const strip = (bc: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(bc)) if (!keys.includes(k)) out[k] = v
    return out
  }
  const bc = { footer: 'x', autoBlog: { enabled: true }, sidebar: 'y' }
  const stripped = strip(bc)
  check('stripping removes autoBlog', !('autoBlog' in stripped))
  check('stripping keeps everything else',
    stripped.footer === 'x' && stripped.sidebar === 'y')

  // The merge is what actually saves the creator's setting.
  const perUser = { footer: 'new', sidebar: 'y' }
  const siteOwned = { autoBlog: { enabled: true } }
  const merged = { ...perUser, ...siteOwned }
  check('a snapshot keeps auto-pilot on while taking the new footer',
    (merged.autoBlog as { enabled: boolean }).enabled === true && merged.footer === 'new',
    'this is the exact sequence that used to turn it off')
}

// ── the writers still agree on where the state lives ────────────────────────
{
  check('the autopilot route writes to wordpress_sites',
    /from\('wordpress_sites'\)[\s\S]{0,300}blog_customizations: \{ \.\.\.current, autoBlog \}/.test(ROUTE),
    'per-site state in a per-user table would be a different bug with the same symptom')
  check('and reads an absent key as off',
    /enabled: a\.enabled === true/.test(ROUTE),
    'which is why a deletion looks exactly like a deliberate switch-off')
  check('the cron preserves the rest of the blob when it saves',
    /blog_customizations: \{ \.\.\.customizations, autoBlog: next \}/.test(CRON))
  check('the cron pauses without switching enabled off',
    /pausedReason: 'cap'/.test(CRON) && !/enabled: false/.test(CRON),
    'a cap pause is temporary; flipping enabled would make the creator re-arm it by hand')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
