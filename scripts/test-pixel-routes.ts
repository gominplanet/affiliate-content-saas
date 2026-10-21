// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A MARKETING PAGE THE PIXEL CANNOT SEE.
//
// This is the same failure as scripts/test-public-routes.ts, one layer along.
// There, a new landing page was reachable in every browser that had a session,
// so /amazon-influencer 307'd every logged-out ad click to /login while
// looking perfectly healthy to the people who built it. Here, a new landing
// page is VISIBLE but not COUNTED: the visitor reads it, the pixel files the
// event under whatever URL they arrived on, and the funnel report shows a page
// that nobody ever reached.
//
// Asked for its URL breakdown over the five days to 2026-10-21, the dataset
// answered with one URL for every event it held. A $13/day campaign ran
// against that and bought 90 landing page views with no way to see where they
// stopped.
//
// So the classification is not maintained by memory. Every page route outside
// app/(dashboard) must be either counted (FUNNEL_ROUTES) or named as not
// counted with a reason (NOT_FUNNEL_ROUTES), and adding one without doing
// either fails the build.
//
// Run: npx tsx scripts/test-pixel-routes.ts
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FUNNEL_ROUTES, NOT_FUNNEL_ROUTES, countsAsFunnelView } from '../lib/pixel-routes'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the predicate ───────────────────────────────────────────────────────────
check('the homepage counts', countsAsFunnelView('/'))
check('and so does a trailing slash', countsAsFunnelView('/pricing/'))
check('a funnel page counts', countsAsFunnelView('/pricing') && countsAsFunnelView('/signup'))
check('a page under one counts', countsAsFunnelView('/join/amazon') && countsAsFunnelView('/docs/anything'))
check('the dashboard does not', !countsAsFunnelView('/drop') && !countsAsFunnelView('/deal-radar') && !countsAsFunnelView('/billing'))
check('nor does a page named as not counted', !countsAsFunnelView('/login') && !countsAsFunnelView('/onboarding') && !countsAsFunnelView('/landing-preview'))
// A prefix must not match a longer word. '/partner' and '/partners-only' are
// different pages, and startsWith alone would conflate them.
check('a prefix stops at a segment boundary', !countsAsFunnelView('/partners-only') && !countsAsFunnelView('/pricing-old'))
check('junk is refused rather than counted', !countsAsFunnelView('') && !countsAsFunnelView('pricing')
  && !countsAsFunnelView(undefined as unknown as string))

// A query string is never the difference between two pages: counting
// '/signup?tier=pro' apart from '/signup' would turn every filter change into
// a page view. The component passes a pathname, so this just pins the shape.
check('every entry is a bare path prefix',
  FUNNEL_ROUTES.every((r) => r.startsWith('/') && !r.includes('?') && !r.endsWith('/')),
  FUNNEL_ROUTES.filter((r) => !r.startsWith('/') || r.includes('?') || r.endsWith('/')).join(', '))

// ── every page route is classified ──────────────────────────────────────────
//
// Enumerated from disk, so this cannot be satisfied by remembering. Route
// groups are parentheses directories: they do not appear in the URL, so
// (auth)/signup is '/signup' and its children are classified individually.
// (dashboard) is the signed-in product by construction, all 89 of it, and is
// not enumerated.
{
  const APP = 'app'
  const hasPage = (dir: string): boolean => {
    if (existsSync(join(dir, 'page.tsx'))) return true
    let found = false
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      if (hasPage(join(dir, e.name))) { found = true; break }
    }
    return found
  }

  const routes: string[] = []
  for (const e of readdirSync(APP, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'api') continue
    // The signed-in product. One group, excluded wholesale.
    if (e.name === '(dashboard)') continue
    if (e.name.startsWith('(')) {
      for (const c of readdirSync(join(APP, e.name), { withFileTypes: true })) {
        if (c.isDirectory() && hasPage(join(APP, e.name, c.name))) routes.push(`/${c.name}`)
      }
      continue
    }
    if (hasPage(join(APP, e.name))) routes.push(`/${e.name}`)
  }

  check('the app directory was read', routes.length > 15, `${routes.length} page routes found`)

  const counted = new Set<string>(FUNNEL_ROUTES)
  for (const r of routes) {
    check(`${r} is classified`,
      counted.has(r) || r in NOT_FUNNEL_ROUTES,
      'add it to FUNNEL_ROUTES, or to NOT_FUNNEL_ROUTES with the reason it is not a prospect page')
  }

  // The other direction: a route named here that no longer exists is a stale
  // entry, and a stale entry is how a list starts lying.
  for (const r of FUNNEL_ROUTES) {
    check(`${r} still exists`, routes.includes(r), 'remove it, or restore the page')
  }
  for (const r of Object.keys(NOT_FUNNEL_ROUTES)) {
    check(`${r} still exists`, routes.includes(r), 'remove it, or restore the page')
  }
  check('nothing is in both lists',
    !FUNNEL_ROUTES.some((r) => r in NOT_FUNNEL_ROUTES),
    FUNNEL_ROUTES.filter((r) => r in NOT_FUNNEL_ROUTES).join(', '))
  check('every exclusion carries a reason',
    Object.values(NOT_FUNNEL_ROUTES).every((v) => typeof v === 'string' && v.length > 15))
}

// ── the component fires once per navigation, never on the landing ───────────
//
// The inline script in app/layout.tsx already counts the first page of a
// visit. Firing on mount as well would double every landing, which reads as
// twice the traffic and half the conversion rate.
{
  const C = readFileSync('components/analytics/PixelRouteViews.tsx', 'utf8')
  check('it reads the path from the router', /usePathname\(\)/.test(C))
  check('it asks lib/pixel-routes rather than deciding for itself', /countsAsFunnelView\(pathname\)/.test(C))
  check('the landing page is recorded without being sent again',
    /counted\.current === null/.test(C) && /counted\.current = pathname\n\s+return/.test(C),
    'without the first-run guard every hard load counts twice')
  check('and the same path twice in a row sends nothing',
    /pathname === counted\.current/.test(C),
    'a re-render must not be a page view')
  check('it sends a plain PageView', /trackMeta\('PageView'\)/.test(C))

  const L = readFileSync('app/layout.tsx', 'utf8')
  check('the layout mounts it', /<PixelRouteViews \/>/.test(L))
  check('only in production, like the pixel it completes',
    L.indexOf("process.env.NODE_ENV === 'production'") < L.indexOf('<PixelRouteViews />'),
    'a preview deployment files its own loads in the live dataset')
  check('the inline PageView is still there', /fbq\('track', 'PageView'\)/.test(L),
    'this component completes that script, it does not replace it')
}

if (failures.length) {
  console.error(`\n❌ pixel-routes: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ pixel-routes: every page outside the dashboard is either counted or named as not counted, and a navigation fires one PageView')
