// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE MEMBER NEWSLETTER IS RETIRED, AND MVP'S OWN LIST STILL WORKS.
//
// Decided 2026-10-05 (Seb): zero newsletter sends by any member ever, and one
// draft in June. One switch, lib/feature-flags NEWSLETTER_FOR_MEMBERS, hides
// the tool from everyone but admin, refuses the member API routes with a 410,
// takes it off the Pro plan, and nothing that sells MVP may still promise it.
// The public routes that forms, emailed links and Resend call must NOT read
// the switch: MVP's own list (the free guide, admin broadcasts) runs on them.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { NEWSLETTER_FOR_MEMBERS } from '../lib/feature-flags'
import { newsletterRetired, NEWSLETTER_RETIRED_ERROR } from '../lib/newsletter-retired'
import { TIERS, allowedNewsletterSubscribers, allowedNewsletterBroadcasts } from '../lib/tier'
import { MVP_FEATURES_DOC } from '../lib/assistant-features-doc'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const r = (p: string) => readFileSync(p, 'utf8')

// A Supabase stand-in that answers the one query the gate makes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeDb = (tier: string | null): any => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tier ? { tier } : null }) }) }) }),
})

async function main() {
  // ── the switch ────────────────────────────────────────────────────────────
  check('the switch exists in lib/feature-flags and is off',
    /export const NEWSLETTER_FOR_MEMBERS = false/.test(r('lib/feature-flags.ts')) && NEWSLETTER_FOR_MEMBERS === false)

  // ── the gate answers 410 for a member, and nothing for admin ──────────────
  for (const tier of ['pro', 'amazon', 'creator', 'studio', 'trial']) {
    const res = await newsletterRetired(fakeDb(tier), 'user')
    const body = res ? await res.json() : null
    check(`a ${tier} member gets 410 "${NEWSLETTER_RETIRED_ERROR}"`,
      res?.status === 410 && body?.error === 'The newsletter has been retired.',
      res ? `${res.status} ${JSON.stringify(body)}` : 'no response, so the route would carry on')
  }
  check('an account with no integrations row is refused too', (await newsletterRetired(fakeDb(null), 'user'))?.status === 410)
  check('admin keeps the tool', (await newsletterRetired(fakeDb('admin'), 'user')) === null)

  // ── every member route under /api/newsletter calls it, after auth ─────────
  const PUBLIC = new Set(['subscribe', 'unsubscribe', 'confirm', 'resend-webhook'])
  const routes: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'route.ts') routes.push(p)
    }
  }
  walk('app/api/newsletter')
  const AUTH = "if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })\n  const retired = await newsletterRetired(supabase, user.id)\n  if (retired) return retired"
  for (const p of routes) {
    const top = p.split('/')[3]
    const src = r(p)
    if (PUBLIC.has(top)) {
      // subscribe reads it for one thing only: a member's leftover blog form
      // says signups are closed. An admin owner (MVP's own list) passes.
      if (top === 'subscribe') {
        check(`${p} closes member signups, never MVP's own`,
          /if \(!NEWSLETTER_FOR_MEMBERS && tier !== 'admin'\) \{\s*return json\(\{ ok: false, error: 'Signups for this newsletter are closed\.' \}, \{ status: 410 \}\)/.test(src)
            && !/newsletterRetired/.test(src))
      } else {
        check(`${p} is public and does not read the switch`,
          !/NEWSLETTER_FOR_MEMBERS|newsletterRetired|newsletter-retired/.test(src))
      }
      continue
    }
    const handlers = (src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
    const gated = src.split(AUTH).length - 1
    check(`${p}: every handler is refused right after its auth check`,
      handlers > 0 && gated === handlers, `${gated} gated of ${handlers} handlers`)
  }
  for (const p of ['app/api/newsletter/broadcasts/route.ts', 'app/api/newsletter/send/route.ts']) {
    const src = r(p)
    check(`${p} refuses before it reads anything`,
      src.indexOf('await newsletterRetired(') > 0
        && src.indexOf('await newsletterRetired(') < src.indexOf(".from('newsletter_")
        && (!src.includes('denyNewsletterWrite(user.id)') || src.indexOf('await newsletterRetired(') < src.indexOf('denyNewsletterWrite(user.id)')))
  }
  check('MVP\'s own list does not read the switch',
    !/NEWSLETTER_FOR_MEMBERS|newsletterRetired/.test(r('app/api/freeguide/subscribe/route.ts') + r('app/api/admin/broadcast/route.ts')))
  for (const p of ['app/newsletter-confirmed/page.tsx', 'app/newsletter-unsubscribed/page.tsx']) {
    check(`${p} still exists and does not read the switch`, existsSync(p) && !/NEWSLETTER_FOR_MEMBERS/.test(r(p)))
  }

  // ── the screens ───────────────────────────────────────────────────────────
  const SHELL = r('components/layout/DashboardShellV2.tsx')
  check('the sidebar item is gated on the switch, admin excepted',
    /href: '\/newsletter'[^\n]*gate: NEWSLETTER_FOR_MEMBERS \|\| effectiveTier === 'admin'/.test(SHELL))
  check('the Amazon walled garden does not upsell a retired tool',
    /\.\.\.\(NEWSLETTER_FOR_MEMBERS \? \[\{ prefix: '\/newsletter'/.test(SHELL))
  for (const p of ['app/(dashboard)/newsletter/page.tsx', 'app/(dashboard)/newsletter/compose/page.tsx']) {
    check(`${p} shows the retired notice instead of the tool`,
      /const retired = useNewsletterRetired\(\)/.test(r(p)) && /if \(retired\) return <NewsletterRetiredNotice \/>/.test(r(p)))
  }
  const NOTICE = r('components/newsletter/NewsletterRetiredNotice.tsx')
  check('the notice is gated on the switch with admin excepted',
    /if \(NEWSLETTER_FOR_MEMBERS\) return false/.test(NOTICE) && /return tier !== 'admin'/.test(NOTICE))
  check('the notice says it plainly, without dash punctuation',
    /has been retired/.test(NOTICE) && !/[—–]| - /.test(NOTICE.slice(NOTICE.indexOf('export function NewsletterRetiredNotice'))))
  check('the dashboard shortcut is gated', /\(NEWSLETTER_FOR_MEMBERS \|\| tier === 'admin'\) && \(\s*<BigAction href="\/newsletter"/.test(r('app/(dashboard)/dashboard/page.tsx')))

  // ── no newsletter is pushed into a member's blog ──────────────────────────
  const CUST = r('app/api/wordpress/customizations/route.ts')
  check('the WordPress signup form is pushed switched off for members',
    /const newsletterOn = NEWSLETTER_FOR_MEMBERS \|\| /.test(CUST)
      && /const nlEnabled = newsletterOn && /.test(CUST)
      && /if \(!newsletterOn \|\| !ni/.test(CUST))
  const CPAGE = r('app/(dashboard)/customize/page.tsx')
  check('Customize Blog hides both newsletter controls',
    /const showNewsletter = NEWSLETTER_FOR_MEMBERS \|\| viewerTier === 'admin'/.test(CPAGE)
      && /\{showNewsletter && data\.layout\.enableComments && \(/.test(CPAGE)
      && /\{showNewsletter && <Section/.test(CPAGE))

  // ── the plan ──────────────────────────────────────────────────────────────
  const pro = TIERS.pro
  check('Pro includes no newsletter',
    pro.newsletterSubscribers === 0 && pro.newsletterBroadcastsPerMonth === 0
      && !pro.newsletterScheduling && !pro.newsletterABTesting && !pro.newsletterSegmentedSends,
    JSON.stringify([pro.newsletterSubscribers, pro.newsletterBroadcastsPerMonth, pro.newsletterScheduling, pro.newsletterABTesting, pro.newsletterSegmentedSends]))
  // The frozen plans too: they keep every other allowance, but a list nobody
  // can send to is not one, and Pro has to stay a superset of them.
  for (const t of ['creator', 'studio'] as const) {
    check(`${t} (frozen) has no newsletter left either`,
      TIERS[t].newsletterSubscribers === 0 && TIERS[t].newsletterBroadcastsPerMonth === 0 && !TIERS[t].newsletterScheduling)
  }
  check('nor does a grandfathered Creator list',
    allowedNewsletterSubscribers('creator', { legacyCreatorNewsletter: true }) === 0
      && allowedNewsletterBroadcasts('creator', { legacyCreatorNewsletter: true }) === 0)
  check('no newsletter usage bar',
    /if \(NEWSLETTER_FOR_MEMBERS\) \{\s*push\('newsletter'/.test(r('app/api/usage/summary/route.ts'))
      && /NEWSLETTER_FOR_MEMBERS \|\| b\.key !== 'newsletter'/.test(r('components/usage/YourUsage.tsx')))

  // ── the help desk does not offer it ───────────────────────────────────────
  check('the assistant is told it is retired', /## NEWSLETTER \(RETIRED\)/.test(MVP_FEATURES_DOC))
  check('and is given no way to use it',
    !/\/newsletter\b/.test(MVP_FEATURES_DOC.replace('link to\n/newsletter', '')) && !/- Newsletter:/.test(MVP_FEATURES_DOC),
    (MVP_FEATURES_DOC.match(/[^\n]*(\/newsletter\b|- Newsletter:)[^\n]*/) ?? [''])[0])
  check('search does not offer it', /\.\.\.\(NEWSLETTER_FOR_MEMBERS \? \[\{ label: 'Newsletter'/.test(r('lib/app-search-index.ts')))

  // ── nothing that sells MVP still sells it ─────────────────────────────────
  // Comments are stripped first: a note saying why the newsletter row went is
  // fine, a sentence a buyer can read is not.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const MARKETING = [
    'app/page.tsx', 'app/pricing/page.tsx', 'lib/plan-compare.ts', 'app/tour/page.tsx',
    'app/opengraph-image.tsx', 'app/tour/opengraph-image.tsx',
    'components/tour/tour-content.tsx', 'app/(dashboard)/pro-tour/page.tsx',
    'components/dashboard/ProTourBanner.tsx', 'components/dashboard/AmazonDashboard.tsx',
    'components/upgrade/AmazonUpgradeGate.tsx',
    ...readdirSync('components/landing').filter((f) => f.endsWith('.tsx')).map((f) => `components/landing/${f}`),
  ]
  for (const p of MARKETING) {
    const hit = stripComments(r(p)).match(/[^\n]*newsletter[^\n]*/i)
    check(`${p} does not sell a newsletter`, !hit, hit?.[0].trim().slice(0, 140))
  }
  check('the bundle math no longer counts a newsletter tool', !/Beehiiv/.test(stripComments(r('app/pricing/page.tsx'))))
}

main().then(() => {
  if (failures.length) {
    console.error(`\n❌ newsletter-retired: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✓ newsletter-retired: members get a 410 and a plain notice, admin keeps the tool, Pro includes none, nothing sells it, and the public subscribe routes are untouched')
})
