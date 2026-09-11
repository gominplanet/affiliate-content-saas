// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A marketing page nobody logged out can reach.
//
// middleware.ts redirects anything not on its whitelist to /login. That list is
// maintained by hand, and a page added months later is public in every way the
// author can see: it is outside the (dashboard) group, it has marketing
// metadata, it renders perfectly in a browser that happens to have a session.
// Which describes every browser the people who build it are using.
//
// /amazon-influencer sat like that while a live ad campaign pointed at it. Every
// logged-out click 307'd to the login screen, so the campaign read as a
// near-total bounce with no cause anyone could see, and the page looked healthy
// to everyone who checked it. /features, and both newsletter pages reached only
// from a link in an email, were in the same state.
//
// So the whitelist is no longer maintained by memory. Every page route outside
// the authenticated groups must be either whitelisted or named here as private
// on purpose, and adding one without doing either fails the build.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── what middleware lets through ────────────────────────────────────────────
const MW = readFileSync('middleware.ts', 'utf8')
const listStart = MW.indexOf('const publicPaths = [')
const listSrc = MW.slice(listStart, MW.indexOf('\n]', listStart))
// Comment lines are dropped BEFORE the quoted strings are read. The block is
// heavily commented and English is full of apostrophes ("doesn't", "needn't"),
// so a naive scan for '…' pulls `t` out of a comment and calls it a route.
const publicPaths = listSrc
  .split('\n')
  .map(l => l.trim())
  .filter(l => !l.startsWith('//') && !l.startsWith('const'))
  .flatMap(l => [...l.matchAll(/'([^']+)'/g)].map(m => m[1]))
check('the whitelist was parsed', publicPaths.length > 10, `${publicPaths.length} entries`)

// Same rule as middleware's isPublic: segment boundaries, so '/join' covers
// '/join/amazon' but '/api/brand-inquiry' never covers '/api/brand-inquiries'.
const isPublic = (p: string) => p === '/' || publicPaths.some(w => p === w || p.startsWith(w + '/'))

// ── every page route that is not behind a login by design ───────────────────
//
// Route groups in parentheses do not appear in the URL, so (auth)/signup is
// /signup. (dashboard) is the authenticated app and is skipped wholesale.
function routes(dir: string, url = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (!statSync(full).isDirectory()) {
      if (entry === 'page.tsx') out.push(url || '/')
      continue
    }
    if (entry === 'api' || entry.startsWith('_') || entry.startsWith('[')) continue
    if (entry === '(dashboard)') continue
    const segment = entry.startsWith('(') ? '' : `/${entry}`
    out.push(...routes(full, url + segment))
  }
  return out
}

// Pages that are SUPPOSED to need a session. Each needs a reason, because
// "private" is a decision and this list is where it is recorded.
const INTENTIONALLY_PRIVATE: Record<string, string> = {
  '/onboarding': 'post-signup setup; there is no account to set up until they have one',
  '/landing-preview': 'internal preview of a marketing layout, not linked publicly',
}

const found = routes('app').sort()
check('page routes were found', found.length > 5, found.join(' '))

for (const r of found) {
  if (INTENTIONALLY_PRIVATE[r]) {
    check(`${r} is deliberately private and not also whitelisted`,
      !isPublic(r),
      'it is listed as private here but middleware lets it through; one of the two is wrong')
    continue
  }
  check(`${r} is reachable logged out`, isPublic(r),
    'add it to publicPaths in middleware.ts, or to INTENTIONALLY_PRIVATE here with a reason')
}

// ── the pages that carry money ──────────────────────────────────────────────
//
// Called out by name rather than left to the sweep above. These are the ones
// where being private costs a campaign rather than a visit.
for (const r of ['/amazon-influencer', '/join/amazon', '/pricing', '/features']) {
  check(`the ad and pricing route ${r} is public`, isPublic(r),
    'a logged-out click on this is somebody the ads were paid for')
}
check('one entry covers the whole /join tree', isPublic('/join/creator') && isPublic('/join/anything'),
  'so a second ad landing does not have to remember this file exists')

// ── links inside an email land on a page, not a login form ──────────────────
for (const r of ['/newsletter-confirmed', '/newsletter-unsubscribed']) {
  check(`${r} is public`, isPublic(r),
    'reached only from an email, so by definition from a logged-out browser')
}

// ── the whitelist itself has not been loosened ──────────────────────────────
{
  // A bare '/' or an empty entry would whitelist the entire app, which is the
  // one edit to this file that nobody would notice until it mattered.
  check('no entry whitelists everything',
    !publicPaths.some(p => p === '' || p === '/'),
    publicPaths.filter(p => p === '' || p === '/').join(','))
  check('every entry is an absolute path',
    publicPaths.every(p => p.startsWith('/')),
    publicPaths.filter(p => !p.startsWith('/')).join(','))

  // The dashboard must never be reachable without a session.
  for (const guarded of ['/dashboard', '/content', '/amazon/thumbnails', '/settings', '/billing']) {
    check(`${guarded} still needs a session`, !isPublic(guarded),
      'a whitelist entry has been widened past what it was for')
  }
}

if (failures.length) {
  console.error(`\n❌ public-routes: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ public-routes: every marketing page is reachable logged out, and the app still is not')
