// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One choice, honoured everywhere.
//
// The rule: whatever a creator picks in Brand Profile is what MVP builds, on
// every surface. Not "usually", and not "unless another control disagrees".
//
// It is already true, and this file exists because it is true by arrangement
// rather than by construction, so it can quietly stop being true. Two stored
// values decide a creator's links: passport_links_enabled and
// blog_social_link_mode. They are kept mutually exclusive by the Brand Profile
// tiles, which turn Passport OFF when any other style is picked and ON when
// Passport is. Nothing structural stops a future screen from setting one
// without the other, and the failure would be invisible: links keep working,
// they are just not the ones the creator asked for.
//
// This was nearly broken from the other direction too. Reading the stored mode
// as an explicit choice that outranks the Passport toggle looks like the fix
// for a creator whose chooser said Geniuslink while Passport was in use. It
// would have switched Passport off for every Passport account on the platform,
// because the mode is the style used when Passport is off, not a competing
// vote, and the settings screen writes its displayed value back on any save.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickLinkStyle } from '../lib/link-style'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const BRAND = read('app/(dashboard)/brand/page.tsx')
const RESOLVE = read('lib/affiliate-resolve.ts')

// ── the two controls stay mutually exclusive ────────────────────────────────
{
  const fn = BRAND.slice(BRAND.indexOf('async function selectLinkStyle'), BRAND.indexOf('async function selectLinkStyle') + 1800)
  check('the style picker is findable', fn.length > 0, 'brand/page.tsx changed shape')
  check('picking Passport turns the flag on',
    /style === 'passport'[\s\S]{0,600}enabled: true/.test(fn))
  check('picking any other style turns Passport OFF',
    /enabled: false/.test(fn),
    'without this a creator can pick Geniuslink and still get Passport, which is the exact complaint')
  check('and then stores the mode', /setBlogSocialLinkMode\(style\)/.test(fn))
  check('the card shows what will ACTUALLY be built',
    /passportActive \? 'passport' : blogSocialLinkMode/.test(BRAND),
    'a card showing a choice the product does not honour is worse than no card')
}

// ── the resolver every surface shares honours that choice ───────────────────
// Not each caller deciding for itself. This is what makes the pick universal.
{
  check('the shared resolver reads the style', /getLinkStyle\(/.test(RESOLVE))
  for (const [style, marker] of [
    ['passport', /cfg\.style === 'passport'/],
    ['bitly', /cfg\.style === 'bitly'/],
    ['geniuslink', /cfg\.style === 'geniuslink'/],
  ] as const) {
    check(`it builds ${style} when that is the choice`, marker.test(RESOLVE))
  }
  check('a Passport mint failure falls back to the plain tagged link',
    /passport \|\| tagFallback\(\)/.test(RESOLVE),
    'never to Geniuslink, which the creator did not pick')
  check('and Passport covers non-Amazon destinations too',
    /passportLinkForDestination\(/.test(RESOLVE),
    'the promise is EVERY link, not only Amazon ASINs')
}

// ── minting is a system action, so it uses the service role ─────────────────
// The blog job runs with no user session. When the mint used the caller's
// client, RLS hid the creator's own row from their own generation, the
// eligibility check read that as "Passport is off", and every post fell back to
// a plain Amazon link. Silently, for every Passport creator, for weeks.
{
  const PASSPORT = read('lib/passport-links.ts')
  for (const fn of ['passportLinkForUser', 'passportLinkForDestination']) {
    const at = PASSPORT.indexOf(`export async function ${fn}`)
    check(`${fn} is findable`, at > 0)
    const body = PASSPORT.slice(at, at + 2200)
    check(`${fn} mints with the service role`,
      /createAdminClient\(\)/.test(body),
      'the caller\'s client has no session in the job queue, so RLS returns nothing and Passport silently never happens')
  }
}

// ── the precedence itself ───────────────────────────────────────────────────
{
  check('Passport on wins over a stored fallback mode',
    pickLinkStyle({ passportEligible: true, mode: 'geniuslink', hasBitly: true, hasGeniuslink: true }) === 'passport',
    'the mode is what to use when Passport is off, not a competing vote')
  check('Passport off honours the stored mode',
    pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: true }) === 'geniuslink')
  check('a chosen style with no credentials falls to direct rather than to something unasked-for',
    pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: false }) === 'direct')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
