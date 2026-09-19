// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EACH BLOG POSTS TO ITS OWN ACCOUNT, AND A CREATOR WITH ONE BLOG IS UNTOUCHED.
//
// social_accounts is keyed on (user, platform) and is_default picks one row per
// pair. A creator with several blogs has one Facebook page per blog, so every
// site resolved to the same account and one blog's posts went to another blog's
// audience. blog_posts.wordpress_site_id has always existed and picks the
// WordPress credentials to publish with; the social resolver never got it.
//
// Two halves are pinned here, and the second matters as much as the first. This
// ships to every creator, and almost none of them have a routing question. A
// creator who sets nothing must resolve exactly as they did before, through the
// same steps in the same order, or a feature three people asked for becomes a
// regression for everybody else.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const RESOLVER = live(read('lib/social-accounts.ts'))
const HELPERS = live(read('lib/site-social-defaults.ts'))
const MIGRATION = read('supabase/migrations/346_site_social_defaults.sql')

// ── the resolver consults the site, in the right place ──────────────────────
{
  check('the resolver reads the per-site table',
    /from\('site_social_defaults'\)/.test(RESOLVER),
    'without this the whole feature is a settings screen that changes nothing')

  check('and takes a siteId to read it with',
    /siteId\?: string \| null/.test(RESOLVER))

  // The step must read the CALLER'S site. Found by break-testing: replacing
  // `opts.siteId` with a constant null leaves the table query, the ordering and
  // every clause below intact, and quietly disables the whole feature. The
  // query being present is not the same as the query running.
  check('and the site step reads the value the caller passed',
    /const siteId = opts\.siteId\b/.test(RESOLVER),
    'a constant here kills the feature while every other clause still passes')

  // ORDER IS THE FEATURE. An explicit per-post pick must still win, or the Pro
  // account picker silently stops working; and the site step must come before
  // the user-wide default, or it never applies.
  const explicitAt = RESOLVER.indexOf('allowSelection) {')
  const siteAt = RESOLVER.indexOf("from('site_social_defaults')")
  const userDefaultAt = RESOLVER.indexOf(".eq('is_default', true)")
  check('an explicit per-post choice still wins', explicitAt > -1 && explicitAt < siteAt,
    'the Pro account picker outranks a site default; reversing them ignores what the creator just clicked')
  check('the site default outranks the user-wide default', siteAt > -1 && siteAt < userDefaultAt,
    'below the user default it can never apply, which is the bug it exists to fix')
  check('the legacy integrations fallback is still last',
    userDefaultAt > -1 && userDefaultAt < RESOLVER.indexOf('legacy?.externalId'))
}

// ── a creator who sets nothing is untouched ─────────────────────────────────
{
  // The site query must be SKIPPED, not merely return nothing. 'legacy' is not
  // a uuid, so querying with it makes Postgres reject the read.
  check('the site step is skipped without a routable site id',
    /if \(siteId && siteId !== 'legacy'\)/.test(RESOLVER),
    "'legacy' means no wordpress_sites row exists; comparing it to a uuid column errors")

  check("and 'legacy' is rejected centrally too",
    /siteId !== 'legacy'/.test(HELPERS),
    'both sides have to agree on what a routable site is')

  // A mapping that resolves to a deleted or token-less account must fall
  // through, never fail the post.
  const siteBlock = RESOLVER.slice(RESOLVER.indexOf("from('site_social_defaults')"))
    .slice(0, RESOLVER.slice(RESOLVER.indexOf("from('site_social_defaults')")).indexOf(".eq('is_default', true)"))
  check('an unusable site mapping falls through rather than throwing',
    /if \(acct\?\.external_id && acct\?\.access_token\)/.test(siteBlock),
    'a post going to the main page beats a post that does not go out')
  check('and the token is decrypted like every other branch',
    /maybeDecrypt\(acct\.access_token\)/.test(siteBlock),
    'social tokens are encrypted at rest; handing Meta the ciphertext is a dead post')
}

// ── the fan-out path is not the one place this is forgotten ─────────────────
//
// Three quick-post modals each answered "which accounts are connected" their
// own way once, and two of them got fixed. The plural resolver falling back to
// "the default" has to mean this site's default too.
{
  const plural = RESOLVER.slice(RESOLVER.indexOf('export async function resolveSocialAccounts'))
  check('resolveSocialAccounts accepts a siteId', /siteId\?: string \| null/.test(plural))
  check('and forwards it to the single resolver', /siteId: opts\.siteId \?\? null/.test(plural),
    'a fan-out that drops it is the one surface where per-site routing silently does not apply')
}

// ── the posting routes actually pass a site ─────────────────────────────────
//
// Named, because the resolver accepting a siteId that nobody sends is exactly
// the shape of a feature that tests green and does nothing.
{
  const FB = live(read('app/api/blog/facebook-post/route.ts'))
  check('the Facebook publish path passes the post\'s site',
    /siteId: routableSiteId\(post\.wordpress_site_id\)/.test(FB),
    'Facebook pages per blog is the case this was built for')
  check('and reads it off the row it already selected',
    /select\('id,title[^']*wordpress_site_id/.test(FB),
    'a second query per publish to re-read a column already in a local variable')

  const IG = live(read('app/api/blog/instagram-post/route.ts'))
  check('the Instagram publish path passes the post\'s site',
    /siteId: await siteIdForPost\(/.test(IG),
    'its post row is fetched after the resolve and omits the column, so the lookup is the right call here')
}

// ── the helper cannot point a site at somebody else's page ──────────────────
{
  check('the write checks the site belongs to the caller',
    /from\('wordpress_sites'\)[\s\S]{0,140}\.eq\('user_id', userId\)/.test(HELPERS))
  check('and that the account does too',
    /from\('social_accounts'\)[\s\S]{0,160}\.eq\('user_id', userId\)/.test(HELPERS),
    'RLS scopes the write to the creator but cannot tell that the account they named is theirs')
  check('and that the account is on the platform being set',
    /from\('social_accounts'\)[\s\S]{0,200}\.eq\('platform', platform\)/.test(HELPERS),
    'an Instagram account mapped as a Facebook page fails at publish time, far from the cause')

  // Clearing is a delete, so "no mapping" has exactly one representation.
  check('clearing a mapping deletes the row',
    /socialAccountId === null[\s\S]{0,200}\.delete\(\)/.test(HELPERS),
    'a row with a null account would be a second way to say the same thing, and a branch nobody tests')
}

// ── the migration ───────────────────────────────────────────────────────────
{
  check('safe to run twice',
    /create table if not exists/i.test(MIGRATION)
    && /create index if not exists/i.test(MIGRATION)
    && /drop policy if exists/i.test(MIGRATION))
  check('one account per site per platform',
    /unique \(site_id, platform\)/.test(MIGRATION),
    'the settings screen upserts on this constraint')
  check('both sides cascade on delete',
    (MIGRATION.match(/on delete cascade/g) ?? []).length >= 3,
    'a mapping pointing at a deleted site or account would resolve to nothing')
  check('RLS is on and owner-only',
    /enable row level security/i.test(MIGRATION) && /auth\.uid\(\) = user_id/.test(MIGRATION))
}

// ── the screen does not appear where there is nothing to decide ─────────────
{
  const UI = read('components/social/SiteSocialRouting.tsx')
  check('it renders nothing for a single-site creator',
    /if \(loading \|\| !applies\) return null/.test(UI))
  check('and nothing when no platform has a second account',
    /routable\.length === 0\) return null/.test(UI),
    'with one Facebook page there is nothing to route it to')
  check('the fallback option names the account it falls back to',
    /Use my main account \(\$\{fallback\}\)/.test(UI),
    'saying "Default" makes the reader go and look up which one that is')
  // House style, on copy a creator reads.
  const copy = UI.match(/>\s*\n?\s*You have more than one blog[\s\S]*?<\/p>/)?.[0] ?? ''
  check('the explanation was found', copy.length > 40, `${copy.length} chars`)
  check('no dash punctuation in the explanation',
    !/[—–]/.test(copy) && !/\S \- \S/.test(copy), copy.slice(0, 120))
}

if (failures.length) {
  console.error(`\n❌ site-social-routing: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ site-social-routing: each blog posts to its own account, and a creator who sets nothing is untouched')
