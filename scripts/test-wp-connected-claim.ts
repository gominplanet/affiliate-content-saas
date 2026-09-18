// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCREEN THAT COULD NOT SAY "NO".
//
// 17 Sep 2026, from a creator with 48 published posts:
//
//   "Now my Word Press Site doesn't seem to be working correctly. When I tried
//    to create my blog post, it says the site is not connected. When I go to
//    connect the site in setup, it shows 'Your blog is live and connected'
//    under blog set up, but on the top bar it says 'No WordPress yet'.
//    Ugh, I am so sorry I keep having issues."
//
// She apologised. Three of MVP's four screens were right.
//
//   · generating a post   → "WordPress not connected"   (resolves credentials)
//   · the topbar chip     → "No WordPress yet"          (/api/wordpress/sites)
//   · the admin user card → "not connected"             (same source)
//   · /setup              → "Your blog is live and connected" ✅
//
// Everything that publishes resolves through wordpress_sites. /setup alone
// decided off `integrations.onboarding_completed`, a record that she once
// finished the wizard. It says nothing about whether the credentials still
// exist. Hers did not, so the one screen she opened to check her connection was
// the only screen that could not see the problem, and the green check sent her
// to apologise for a fault that was ours.
//
// The flag itself is not the bug and is not removed here: it decides whether to
// show the manager or the wizard, and an onboarded creator must never be dumped
// back into a blank wizard (Doug, 15 Jul, 18 published posts, stuck on step 4).
// What changed is that it no longer doubles as evidence of a live connection.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
/** Comments stripped. A clause satisfied by a comment describing the bug would
 *  pass on a file where the fix had been reverted. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const SETUP = read('app/(dashboard)/setup/page.tsx')
const SETUP_LIVE = live(SETUP)
const CHIP = live(read('components/layout/SiteSwitcherChip.tsx'))

// ── the claim is conditional now ────────────────────────────────────────────
{
  check('the green claim is gated on something',
    /siteCount === null \?[\s\S]{0,4000}Your blog is live and connected/.test(SETUP_LIVE),
    'it used to render unconditionally inside the manager view')
  check('and the gate is a real site count, not the onboarding flag',
    /const \[siteCount, setSiteCount\] = useState<number \| null>\(null\)/.test(SETUP_LIVE))
  check('read from the same route the topbar and the publisher use',
    /fetch\('\/api\/wordpress\/sites'/.test(SETUP_LIVE) && /fetch\('\/api\/wordpress\/sites'/.test(CHIP),
    'two screens disagreeing is what this whole file is about, so they must read one source')
}

// ── "no" is a state the screen can reach ────────────────────────────────────
{
  check('zero sites renders a different card, not the green one',
    /siteCount === 0 \?/.test(SETUP_LIVE))
  check('and says plainly that new posts will fail',
    /new posts will fail/.test(SETUP),
    'a creator who reads "details missing" still has to guess what breaks')
  check('and reassures that published work is untouched',
    /published posts are safe on your site/.test(SETUP),
    'the first fear on reading this is that the blog is gone')
  check('and explains the topbar she is already looking at',
    /No WordPress yet/.test(SETUP),
    'naming the other screen is what turns two contradicting messages into one')
  check('and offers the action that fixes it',
    /Reconnect my site/.test(SETUP) && /setForceWizard\(true\)/.test(SETUP_LIVE))
}

// ── a failed read is not a disconnection ────────────────────────────────────
//
// The mirror failure. Turning every network hiccup into "your site is
// disconnected" would send working creators through a reconnect they do not
// need, which is the same disease pointing the other way.
{
  check('an unreadable answer is its own state',
    /setSiteCount\(-1\)/.test(SETUP_LIVE) && /siteCount < 0 \?/.test(SETUP_LIVE))
  check('and says it is a settings read that failed, not a dead blog',
    /not a sign your blog is disconnected/.test(SETUP))
  check('nothing is claimed while the answer is still loading',
    /Checking your connection/.test(SETUP),
    'a card that flashes "connected" then contradicts itself is the same lie, briefly')
}

// ── the wizard trap stays shut ──────────────────────────────────────────────
//
// The reason the flag was trusted in the first place. Fixing this must not
// reintroduce the bug it was protecting against.
{
  check('an onboarded creator still lands on the manager, not a blank wizard',
    /if \(connectedUrl \|\| isOnboarded\) \{/.test(SETUP_LIVE) && /setSetupComplete\(true\)/.test(SETUP_LIVE),
    'Doug had 18 published posts and was locked on wizard step 4')
  check('and the reconnect is a button she presses, never a redirect',
    !/if \(siteCount === 0\) setForceWizard\(true\)/.test(SETUP_LIVE),
    'forcing the wizard on a missing credential is how the first bug happened')
}

// ── the latch that nothing lowered ──────────────────────────────────────────
//
// The root cause, found by reading her row rather than by reasoning about the
// screen. She pressed "Disconnect & start over" on 17 Sep. Afterwards:
//
//   onboarding_completed = false          ← restart set it
//   every wordpress_* column = NULL       ← restart set them
//   rows in wordpress_sites  = 0          ← restart deleted them
//   setup_status = 'site_ready'           ← nothing has ever cleared it
//
// Five routes raise setup_status to 'site_ready' on a successful connect.
// Until this commit, no code in the repository ever lowered it, and three
// screens answer "is WordPress connected" from it: /dashboard's wpConnected,
// /content's wpReady, and /setup's isOnboarded. A one-way flag was being read
// as a live status, so disconnecting left the product insisting she was
// connected while every publish failed.
//
// Enumerated rather than spot-checked: ANY update that nulls the WordPress
// credentials has to lower the latch in the same statement. A new disconnect
// path that forgets is the same outage under a different button.
{
  const DISCONNECTS = [
    'app/api/onboarding/restart/route.ts',
    'app/(dashboard)/setup/page.tsx',
  ]
  // Every file in the repo that nulls wordpress_url, so a third disconnect
  // path added later is caught here instead of by the creator who used it.
  const all = execSync(
    `grep -rl "wordpress_url: null" app lib services components --include=*.ts --include=*.tsx`,
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  check('every file that disconnects WordPress is one this test knows about',
    all.every((f) => DISCONNECTS.includes(f)),
    `unlisted: ${all.filter((f) => !DISCONNECTS.includes(f)).join(', ')}`)

  for (const rel of DISCONNECTS) {
    const src = read(rel)
    // The update object that nulls the credentials, from `wordpress_url: null`
    // to the closing brace of that literal.
    const block = src.slice(src.indexOf('wordpress_url: null'))
    const stmt = block.slice(0, block.indexOf('})'))
    check(`${rel} lowers setup_status in the same update that clears the credentials`,
      /setup_status: null/.test(stmt),
      'leaving it at site_ready is what told a creator with no credentials that she was connected')
  }

  check('nothing reads setup_status as connected without something able to clear it',
    /setup_status === 'site_ready'/.test(read('app/(dashboard)/dashboard/page.tsx')),
    'if this stops being the check, the guard above is aimed at the wrong column')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
