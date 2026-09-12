// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every door inside the Amazon hub has to open onto something.
//
// The Amazon plan is a walled garden: DashboardShellV2 keeps a list of path
// prefixes that render an upgrade panel instead of the page. /connect-socials is
// on that list with a redirect card reading "Amazon Influencers connect their
// approved networks right inside Social Influencer" — correct, and helpful.
//
// Both composers on Social Influencer then said, to a creator who could not
// publish: "Facebook isn't connected yet. Connect it to publish." — linked to
// /connect-socials. So the only actionable thing on the screen sent them to a
// card telling them to go to the page they were already on. The connect strip
// with the real buttons was forty pixels above the message.
//
// That is not a broken link; every piece works. It is a loop that only exists
// when you read the two files together, which is why it survived, and why the
// check below is a rule rather than a fix: no link inside the hub may point at a
// path the hub itself walls off.
//
// The second half of this file is the other kind of dead end: a screen whose
// only control is disabled.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the prefixes the shell walls off for this plan ──────────────────────────
const SHELL = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
const lockedBlock = SHELL.slice(
  SHELL.indexOf('AMAZON_LOCKED_PREFIXES'),
  SHELL.indexOf('const amazonLocked'),
)
const LOCKED = Array.from(lockedBlock.matchAll(/prefix: '([^']+)'/g)).map(m => m[1])

check('the locked prefix list was found', LOCKED.length > 10, `${LOCKED.length} found`)
check('and it still includes the one that started this', LOCKED.includes('/connect-socials'),
  'if this moves, the rule below stops guarding the case it was written for')

// ── every in-app link inside the hub ────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const HUB_FILES = [...walk('components/amazon'), ...walk('app/(dashboard)/amazon')]
check('the hub files were found', HUB_FILES.length > 10, `${HUB_FILES.length} found`)

{
  // href="/x", href='/x', href={'/x'} and router.push('/x'). Not /api/… — those
  // are OAuth starts and route handlers, which the shell never intercepts.
  const LINK = /(?:href=["'{]{1,2}|router\.push\(['"])(\/[a-z0-9-/]*)/gi
  const offenders: string[] = []

  for (const f of HUB_FILES) {
    const src = readFileSync(f, 'utf8')
    // A link into a walled-off area is fine when an Amazon-tier user cannot
    // reach it — it is behind a tier check, or it is a deliberate upsell. Say
    // so with `amazon-safe:` and a reason in a comment just above it, so the
    // next person sees the thinking instead of re-deriving it.
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return
      // Six lines back, because the marker sits at the TOP of the comment
      // explaining it and a real explanation runs to three or four lines.
      const prev = lines.slice(Math.max(0, i - 6), i).join('\n')
      if (/amazon-safe:/.test(prev)) return
      for (const m of line.matchAll(LINK)) {
        const href = m[1]
        if (href.startsWith('/api/')) continue
        const hit = LOCKED.find(p => href === p || href.startsWith(`${p}/`))
        if (hit) offenders.push(`${f}:${i + 1} → ${href} (walled off: ${hit})`)
      }
    })
  }

  check('no link inside the Amazon hub points at a path the hub walls off',
    offenders.length === 0, offenders.join(' | '))

  // Prove the scanner works, or the clean result above means nothing.
  const probe = `<a href="/connect-socials">x</a>`
  const found = Array.from(probe.matchAll(LINK)).map(m => m[1])
  check('the link scanner actually finds links', found.includes('/connect-socials'),
    JSON.stringify(found))

  // And that the escape hatch has not quietly become the norm. The rule is only
  // worth having while exemptions are rare enough to read one by one.
  const marked = HUB_FILES.filter(f => /amazon-safe:/.test(readFileSync(f, 'utf8')))
  check('the amazon-safe exemption is still rare', marked.length <= 3,
    `${marked.length} files: ${marked.join(', ')}`)
}

// ── the composers point at the strip that is already on the page ────────────
{
  const CONN = readFileSync('components/amazon/SocialConnections.tsx', 'utf8')
  check('the connect strip is an anchor target', /id="connections"/.test(CONN))
  check('and is not hidden under the sticky header when jumped to',
    /scroll-mt-/.test(CONN), 'an anchor that lands behind the topbar looks like a broken link')

  for (const f of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const src = readFileSync(f, 'utf8')
    check(`${f} sends "Connect it" to the strip on this page`,
      /href="#connections"/.test(src))
  }

  check('the Manage all link is hidden from the plan it dead-ends for',
    /tier !== 'amazon'/.test(CONN),
    '/connect-socials is walled off for Amazon; offering it opens a door onto this same page')
}

// ── the Amazon onboarding is not a locked room ──────────────────────────────
{
  const ONB = readFileSync('components/onboarding/AmazonOnboarding.tsx', 'utf8')

  // The primary button needs the Associates tag, and should: the tag is what
  // makes a free design earn. But it was the ONLY control on the screen, so
  // somebody without their tag to hand — or whose real tag our format check
  // reads wrong — had nothing at all to click.
  check('there is a second way out when the tag is not saved',
    /Look around first/.test(ONB),
    'a screen whose only control is disabled is a locked door')
  check('and it goes somewhere that works without a tag',
    /finish\('\/amazon\/research'\)/.test(ONB),
    'research and Deal Radar are free and uncapped; the generator is not')
  check('the primary button still requires the tag',
    /disabled=\{!ready/.test(ONB),
    'the escape must not become the front door')

  // The completion flag is what stops the dashboard bouncing them off content
  // routes, and /photobooth is one of those — a feature the trial advertises.
  check('leaving waits for the completion flag to be written',
    /await fetch\('\/api\/onboarding'/.test(ONB),
    'fired-and-forgotten, a lost race sends them back to a funnel they finished')
  check('but a failed write still lets them leave',
    /catch \{[^}]*\}\s*\n\s*router\.push/.test(ONB),
    'the gate is recoverable; a screen you cannot leave is not')
}

if (failures.length) {
  console.error(`\n❌ amazon-doors: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ amazon-doors: nothing in the Amazon hub links into its own walled-off area, and the onboarding always has a way out')
