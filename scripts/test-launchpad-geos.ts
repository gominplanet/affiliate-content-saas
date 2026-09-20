// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LAUNCHPAD DELIVERS WHAT ITS OWN PAGE PROMISES, AND SAYS SO WHEN IT CANNOT.
//
// The paywall card sold "a dub per non-English market". The hero said the video
// goes to every geo "dubbed for non-English markets". The surface reached four
// storefronts, all English, with dubbing switched off, and a code comment three
// hundred lines down said so plainly. A creator paid for Pro, read the promise,
// and got no dub anywhere, because nothing connected the sentence to the
// capability.
//
// Two classes of clause here, and the second is the one that matters more.
//
//   THE CAPABILITY. All nine markets are reachable and dubbing is on.
//
//   THE HONESTY. A dub that fails must not be delivered as English audio under
//   a translated title and recorded as success. That failure is invisible from
//   every angle: the URL looks the same, the state says localized, the run says
//   uploaded. The only way anyone finds out is a French shopper pressing play.
import { readFileSync } from 'node:fs'
import { MARKETS } from '../lib/markets'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const PAGE_RAW = read('app/(dashboard)/launchpad/page.tsx')
const PAGE = live(PAGE_RAW)
const GEOCHECK = live(read('app/api/launchpad/geo-check/route.ts'))
const QUEUE = live(read('app/api/global-sync/deliver/queue/route.ts'))
const STAGE = live(read('components/launchpad/StorefrontStage.tsx'))

// ── the promise and the capability are the same thing ───────────────────────
{
  // Read from the RAW page: this is about copy a creator reads, and the copy
  // lives in JSX strings, not in code the comment-stripper keeps.
  const promisesDub = /dub(bed)? (?:per|for) non-English|dubbed for non-English/i.test(PAGE_RAW)
  const dubbingOn = /allowDubbing(?!=\{false\})/.test(PAGE) && !/allowDubbing=\{false\}/.test(PAGE)
  check('if the page promises a dub, the surface can dub',
    !promisesDub || dubbingOn,
    'the paywall card and the hero both sold dubbing while allowDubbing was false')

  check('and it no longer filters its markets down to English',
    !/filter\(isEnglishMarket\)/.test(PAGE),
    'that intersection is what made the promise false')
}

// ── every market the product sells in is reachable ──────────────────────────
{
  // This used to read geo-check's own market table and compare it, domain by
  // domain, against lib/markets. Two lists that must not drift, and the guard
  // was the only thing stopping them.
  //
  // The second list is gone. geo-check derives from MARKETS, so the drift it
  // guarded against can no longer be expressed, and the ids it used to carry
  // (the Keepa domain ids) live in lib/markets where the coverage drain reads
  // them too. The claim is unchanged, so the clauses follow the claim: what
  // matters now is that nothing re-types the table.
  check('geo-check derives its market list from lib/markets',
    /const GEOS = MARKETS\.map\(/.test(GEOCHECK),
    'a typed list is a second copy, and a market added to lib/markets would silently not be offered')
  check('and takes the Keepa ids from there too',
    /keepa: m\.keepa/.test(GEOCHECK) && /keepa: number \| null/.test(live(read('lib/markets.ts'))),
    'the ids lived only in this route, which is how the coverage drain nearly made a third copy')
  check('so it reaches every market, including the ones that need a dub',
    !/\bdomain: 'amazon\./.test(GEOCHECK),
    `${MARKETS.filter((m) => m.needsTranslation).map((m) => m.domain).join(', ')} — a hand-typed domain here means the table came back`)

  // Derivation is only worth anything if lib/markets actually carries what
  // geo-check needs off each row. A market added without a host or a keepa
  // field would derive into a row this route cannot research.
  for (const m of MARKETS) {
    check(`lib/markets gives ${m.domain} a host`, !!m.host && m.host.includes('amazon'),
      'the AU browser check and the cache key are both the host')
    check(`and a Keepa id or an explicit null for ${m.domain}`,
      m.keepa === null || (typeof m.keepa === 'number' && m.keepa > 0),
      'undefined would read as "no Keepa domain" and quietly route a researchable market to the browser')
  }
}

// ── reachable is not the same as researched on every run ────────────────────
//
// Each non-US marketplace is one Keepa lookup. Checking all nine every time
// spends five on an answer most runs never read, which is the kind of cost that
// survives for months because it appears on no screen. So the list above is
// what geo-check CAN research; scope decides what it does.
{
  check('geo-check takes a scope',
    /const scope = body\.scope === 'all'/.test(GEOCHECK))
  check('and defaults to the cheapest answer',
    /body\.scope === 'international' \? 'international' : 'english'/.test(GEOCHECK),
    'a caller that forgets the parameter should cost the least, not the most')
  check('the market list is filtered by it before any lookup',
    GEOCHECK.indexOf('const inScope = GEOS.filter') < GEOCHECK.indexOf('fetchKeepaBrandInfo([asin], g.keepa)')
    && /inScope\.map\(async \(g\)/.test(GEOCHECK),
    'filtering the RESULTS would still have paid for every lookup')
  check("'international' is the five alone, not all nine",
    /scope === 'all' \? true : scope === 'english' \? isEnglish : !isEnglish/.test(GEOCHECK),
    'opting in must not re-pay for the four already answered')
  check('and the second pass can reuse the brand and title',
    /if \(canKeepa && !brand && !title\)/.test(GEOCHECK),
    'otherwise opting in costs six lookups to learn five things')

  // The opt-in has to exist and has to say what it buys, or the markets are
  // reachable in a sense nobody can act on.
  check('the page offers the international check',
    /checkInternationalGeos/.test(PAGE) && /scope: 'international'/.test(PAGE))
  check('and names the markets and what they get',
    /Germany, France, Spain, Italy and Japan are not checked by default/.test(PAGE_RAW),
    '"international" alone does not tell a creator whether their store is in it')

  // ONE SCOUT pass, used by both. A second copy is a second place for the
  // local-ASIN search to quietly not happen, and shipping the US ASIN to
  // amazon.de points at nothing.
  check('both passes share one SCOUT routine',
    /async function runScoutGeoPass/.test(PAGE)
    && (PAGE.match(/runScoutGeoPass\(/g) ?? []).length >= 3,
    'declared once and called by the English pass and the international one')
  check('the international results are appended, not substituted',
    /have\.has\(g\.domain\)/.test(PAGE),
    'the English rows already carry SCOUT statuses this response knows nothing about')
}

// ── a dub that failed is never passed off as one that worked ────────────────
{
  check('the dub response is read',
    /const dr = await fetch\('\/api\/global-sync\/dub'/.test(STAGE)
    && /dubFailures\.push/.test(STAGE),
    'it was fire-and-forget under a catch whose comment said it falls back to the master and told nobody')

  check('and a failure names the market',
    /dubFailures\.map\(d => d\.domain\)/.test(STAGE))

  // BEFORE the upload. Afterwards the video is on the storefront and the
  // creator's only clue is watching it themselves.
  const warnAt = STAGE.indexOf('will get your ENGLISH audio')
  const dubbedWaveAt = STAGE.indexOf("deliverWave(dubDomains")
  check('the warning lands before the dubbed markets upload',
    warnAt > -1 && dubbedWaveAt > -1 && warnAt < dubbedWaveAt,
    'after the upload it is a post-mortem, not a choice')

  check('the warning says what the store will actually receive',
    /ENGLISH audio under a translated title/.test(STAGE),
    '"the dub failed" does not tell a creator that the video still went out')
}

// ── the queue says what each market is about to receive ─────────────────────
{
  check('the queue reports whether a market needed a dub',
    /needsDub: !!r\.dub/.test(QUEUE))
  check('and whether it actually has one',
    /dubbed: !!r\.video_url/.test(QUEUE))
  check('and flags the case where it wanted one and is not getting it',
    /audioIsMasterFallback: !!r\.dub && !r\.video_url/.test(QUEUE),
    'the master fallback is correct for English and for skip-dub, and a silent failure for everything else; they are identical from the URL')

  // The state name promises less than it looks like it promises.
  check('the queue still serves the fallback rather than withholding it',
    !/\.filter\([^)]*audioIsMasterFallback/.test(QUEUE),
    'refusing to serve it would break the English geos and the deliberate skip-dub path both')
}

// ── a market that cannot be delivered is named, not dropped ─────────────────
{
  check('the queue returns what it skipped',
    /const skipped = items/.test(QUEUE) && /skipped \}\)/.test(QUEUE),
    'it used to .filter() them away, so a partial drop left no trace')
  check('with a reason per market',
    /reason: !i\.title/.test(QUEUE))
  check('and the caller surfaces the gap',
    /Not uploaded: \$\{lines\}/.test(STAGE),
    'the empty-queue toast only catches a wave where NOTHING came back; four of five reads as complete')
}

// ── the switch still works, and Storefront Sync still has everything ────────
//
// Inherited from scripts/test-launchpad-english-only, which this file replaces.
// That guard pinned the opposite product decision: Launchpad English-only with
// dubbing off. The decision is reversed, so those clauses are gone, but the
// half about the machinery being intact was always the more valuable half and
// it survives unchanged. "We kept the code" is easy to believe and easy to be
// wrong about after the next tidy-up.
//
// The switch itself stays too. It is off nowhere today, and that is exactly why
// it would rot: a prop with one caller and no test quietly stops working.
{
  check('the stage takes dubbing as a prop defaulting to on',
    /allowDubbing = true/.test(STAGE),
    'Storefront Sync passes nothing and must keep dubbing')
  check('no dub is queued when the switch is off',
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

  check('all nine markets still exist', MARKETS.length === 9, `${MARKETS.length} markets`)
  const SYNC = read('app/(dashboard)/global-sync/page.tsx')
  // STOREFRONT SYNC IS THE COVERAGE BOARD NOW. It used to render the stage with
  // no props, which was how it reached all nine markets with dubbing on. The
  // board reaches them a different way: it offers every market the API returns,
  // and that list is derived from lib/markets rather than typed anywhere. The
  // claim being protected is unchanged, so the check follows the claim.
  check('Storefront Sync reaches every market',
    /<CoverageBoard \/>/.test(SYNC),
    'the board lists whatever /api/coverage/markets returns, which is MARKETS itself')
  check('and that list is never typed out by hand',
    /MARKETS\.map\(/.test(read('app/api/coverage/markets/route.ts')),
    'a typed list drifts from lib/markets the first time a market is added')
  check('Launchpad still asks the stage to dub',
    /allowDubbing/.test(read('app/(dashboard)/launchpad/page.tsx')),
    'the stage is still the one-video path, and it must not quietly stop dubbing')
  check('the dub route still exists',
    (() => { try { return read('app/api/global-sync/dub/route.ts').length > 0 } catch { return false } })())
  check('voice cloning and credits still exist',
    (() => { try { return read('lib/dub-credits.ts').length > 0 && read('lib/tts.ts').length > 0 } catch { return false } })())
  check('the stage can still dub when asked', /async function dubOne/.test(STAGE))
}

// ── the Studio link is the unscoped one, everywhere ─────────────────────────
//
// Launchpad was the only surface building studio.youtube.com/channel/<cid>/
// video/<vid>/edit. A comment justified it: a bare /video/<id>/edit supposedly
// opens under whatever channel Studio is on and throws a generic error. Tested
// against the live account, it is the other way round. The scoped URL is what
// threw "Oops, something went wrong"; the bare one opens the video and switches
// channel by itself.
//
// Swept across the app rather than pinned to Launchpad, because the plausible
// story is what put it there and the same story will occur to the next reader.
{
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const full = `${dir}/${e}`
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(full)) continue
      if (/studio\.youtube\.com\/channel\//.test(live(read(full)))) offenders.push(full)
    }
  }
  walk('app'); walk('components'); walk('lib')
  check('no Studio link is scoped to a channel id',
    offenders.length === 0,
    `${offenders.join(', ')} — a channel that does not own the video answers with a blank error page, and the bare form resolves the owner itself`)
}

// ── house style on the sentences a creator reads ────────────────────────────
{
  const strings = [...PAGE_RAW.matchAll(/(?:description|subtitle)="([^"]{40,})"/g)].map((m) => m[1])
  check('the page copy was found', strings.length > 0, `${strings.length} strings`)
  for (const s of strings) {
    check('no dash punctuation in the page copy',
      !/[—–]/.test(s) && !/\S \- \S/.test(s), s.slice(0, 110))
  }
}

if (failures.length) {
  console.error(`\n❌ launchpad-geos: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launchpad-geos: every market the product sells in is reachable, and a dub that failed is never passed off as one that worked')
