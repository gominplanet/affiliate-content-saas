// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Video Launchpad ships the English storefronts, and no dubbing.
//
// Launchpad is the one-click path: upload once, finish on YouTube, land on
// Amazon. The four English storefronts take the master video exactly as it is,
// so nothing between the click and the upload has to think. A non-English market
// changes that: it needs a translation and a dub, each dub takes a couple of
// minutes, and the fast lane ends up waiting on the slow one.
//
// So the scope is US / Canada / UK / Australia, with dubbing off. This is a
// PRODUCT decision and not a removal: the dub route, the voice cloning, the
// credits and all nine markets are untouched on the standalone Storefront Sync
// page, which is where a creator goes when localizing IS the job.
//
// Two things are pinned here, and the second is the one that would rot quietly.
// First that Launchpad asks for the English four and turns dubbing off. Second
// that Storefront Sync still has everything, because "we kept the code" is easy
// to believe and easy to be wrong about after the next tidy-up.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARKETS, ENGLISH_MARKET_DOMAINS, isEnglishMarket } from '../lib/markets'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const LAUNCHPAD = read('app/(dashboard)/launchpad/page.tsx')
const GEOCHECK = read('app/api/launchpad/geo-check/route.ts')
const STAGE = read('components/launchpad/StorefrontStage.tsx')
const SYNC = read('app/(dashboard)/global-sync/page.tsx')

// ── the English set is exactly the four, and derived rather than retyped ─────
{
  check('there are four English storefronts',
    ENGLISH_MARKET_DOMAINS.length === 4, ENGLISH_MARKET_DOMAINS.join(','))
  for (const d of ['amazon.com', 'amazon.ca', 'amazon.co.uk', 'amazon.com.au']) {
    check(`${d} is English`, isEnglishMarket(d))
  }
  for (const d of ['amazon.de', 'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp']) {
    check(`${d} is not English`, !isEnglishMarket(d))
  }
  // Derived from needsTranslation, so a market added with needsTranslation:false
  // joins the set automatically and the two facts cannot disagree.
  check('the set is derived from needsTranslation, not typed out again',
    MARKETS.filter(m => !m.needsTranslation).length === ENGLISH_MARKET_DOMAINS.length)
}

// ── Launchpad asks only about the English four ──────────────────────────────
{
  for (const d of ['amazon.de', 'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp']) {
    // A commented-out line keeps the Keepa ids for when this comes back, so only
    // live code is searched.
    const live = GEOCHECK.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    check(`geo-check no longer researches ${d}`, !live.includes(`'${d}'`),
      'five Keepa lookups per check that nothing on this screen could act on')
  }
  for (const d of ['amazon.com', 'amazon.ca', 'amazon.co.uk', 'amazon.com.au']) {
    check(`geo-check still researches ${d}`, GEOCHECK.includes(`'${d}'`))
  }
  check('and the page intersects the result with the English set anyway',
    /allowedDomains=\{[^}]*filter\(isEnglishMarket\)/.test(LAUNCHPAD),
    'so the fast lane cannot acquire a market needing a dub it no longer offers')
}

// ── dubbing is off on Launchpad, and it is a switch, not a side effect ──────
{
  check('Launchpad turns dubbing off explicitly', /allowDubbing=\{false\}/.test(LAUNCHPAD))
  check('the stage takes it as a prop defaulting to on',
    /allowDubbing = true/.test(STAGE),
    'the standalone page passes nothing and must keep dubbing')
  check('no dub is queued when it is off',
    /const needDub = allowDubbing \?/.test(STAGE))
  check('and a market that slipped through gets the English master',
    /!allowDubbing \|\| skipDub\.has/.test(STAGE),
    'rather than sitting in a dub queue nothing can start')
  for (const [what, re] of [
    ['the voice card', /\{allowDubbing && voice\?\.enabled &&/],
    ['the skip-dub checkbox', /\{allowDubbing && t\.dub && t\.state !== 'delivered'/],
    ['the dub player', /\{allowDubbing && t\.dub && !skipDub\.has\(t\.domain\) && t\.videoUrl/],
    ['the generate-dub button', /\{allowDubbing && t\.dub && !skipDub\.has\(t\.domain\) && !t\.videoUrl/],
  ] as const) {
    check(`${what} is behind the switch`, re.test(STAGE))
  }
}

// ── the code was KEPT, which is the half that quietly stops being true ──────
{
  check('all nine markets still exist', MARKETS.length === 9, `${MARKETS.length} markets`)
  for (const d of ['amazon.de', 'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp']) {
    check(`${d} is still a supported market`, MARKETS.some(m => m.domain === d))
  }
  check('Storefront Sync still renders the stage with dubbing on',
    /<StorefrontStage \/>/.test(SYNC),
    'no props means every default, which is all nine markets and dubbing')
  check('the dub route still exists', (() => {
    try { return read('app/api/global-sync/dub/route.ts').length > 0 } catch { return false }
  })())
  check('voice cloning and credits still exist', (() => {
    try { return read('lib/dub-credits.ts').length > 0 && read('lib/tts.ts').length > 0 } catch { return false }
  })())
  check('the stage can still dub when asked', /async function dubOne/.test(STAGE))
}

// ── the screen does not promise what this path no longer does ───────────────
{
  check('Launchpad copy no longer offers a dub',
    !/MVP adds a free dub/.test(LAUNCHPAD),
    'a step that promises a dub and shows no dub control is the worst of both')
  check('and points at Storefront Sync for the other markets',
    /global-sync/.test(LAUNCHPAD),
    'the capability still exists, so say where it lives')
  const FEATURES = read('app/features/page.tsx')
  check('the features page no longer says Launchpad reaches every geo',
    !/full Co-Pilot finish, then straight to every Amazon geo/.test(FEATURES))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
