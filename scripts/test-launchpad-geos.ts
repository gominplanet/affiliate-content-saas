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
  // geo-check is Launchpad's market list and lib/markets is everything else's.
  // Two lists that must not drift: a market missing here is one Launchpad can
  // never offer, however well the rest of the pipeline supports it.
  const geoDomains = [...GEOCHECK.matchAll(/domain: '([^']+)'/g)].map((m) => m[1])
  for (const m of MARKETS) {
    check(`geo-check offers ${m.domain}`, geoDomains.includes(m.domain),
      'lib/markets supports it, so Launchpad silently reaching fewer stores is a divergence, not a decision')
  }
  const translated = MARKETS.filter((m) => m.needsTranslation).map((m) => m.domain)
  check('including the ones that need a dub',
    translated.every((d) => geoDomains.includes(d)),
    `${translated.join(', ')} — these are the whole point of the dub lane`)
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
  check('Storefront Sync still renders the stage with every default',
    /<StorefrontStage \/>/.test(SYNC),
    'no props means all nine markets and dubbing on')
  check('the dub route still exists',
    (() => { try { return read('app/api/global-sync/dub/route.ts').length > 0 } catch { return false } })())
  check('voice cloning and credits still exist',
    (() => { try { return read('lib/dub-credits.ts').length > 0 && read('lib/tts.ts').length > 0 } catch { return false } })())
  check('the stage can still dub when asked', /async function dubOne/.test(STAGE))
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
