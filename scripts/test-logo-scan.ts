// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A THUMBNAIL NOBODY COULD OPEN IS NOT A CLEAN THUMBNAIL.
//
// A creator generated a thumbnail, got an Amazon logo rendered into it, and
// pulled the video down. The prompt is fixed, but only for pictures made after
// the fix. Everything before it is still published, and no screen could say
// which ones. This scan answers that, and it can do harm in three directions:
//
//   a false YES     sends somebody to redo a thumbnail that was fine, and after
//                   two of those they stop believing the tool
//   a false NO      leaves a retailer's mark on a creator's video, which is the
//                   Associates agreement problem this is all about
//   a SILENT SKIP   an image that could not be fetched, or an answer that could
//                   not be parsed, reported as clean. Worst of the three,
//                   because the creator reads a green row and concludes their
//                   back catalogue is clear when it was never looked at.
//
// The prompt and the reading of the reply are both pure, so all three are
// pinned here rather than needing a model call to check.
import { readLogoReply, summariseLogoScan, LOGO_SCAN_PROMPT, type LogoFinding } from '../lib/logo-scan'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── a found mark is reported, with what it is ─────────────────────────────
{
  const d = readLogoReply('{"found": true, "marks": ["Amazon"], "confidence": "high"}')
  check('a confident find is a find', d.verdict === 'found', d.verdict)
  check('and names the mark', d.marks.includes('Amazon'), d.marks.join(','))

  const wrapped = readLogoReply('Here is my answer:\n```json\n{"found": true, "marks": ["Walmart"], "confidence": "high"}\n```')
  check('a reply wrapped in prose still parses', wrapped.verdict === 'found', wrapped.verdict)
  check('and keeps the mark', wrapped.marks.includes('Walmart'))

  const unnamed = readLogoReply('{"found": true, "marks": [], "confidence": "high"}')
  check('a confident find with no name is still a find', unnamed.verdict === 'found', unnamed.verdict)
  check('and says something rather than nothing', unnamed.marks.length === 1, unnamed.marks.join(','))
}

// ── a guess is NOT a finding ──────────────────────────────────────────────
{
  const hunch = readLogoReply('{"found": true, "marks": [], "confidence": "low"}')
  check('an unsure find naming nothing is not reported as found', hunch.verdict !== 'found', hunch.verdict)
  check('and is not reported as clean either', hunch.verdict === 'unreadable', hunch.verdict)
  check('and says why', /unsure/i.test(hunch.reason ?? ''), hunch.reason)

  // Unsure but it named something is still worth showing. The creator can look.
  const named = readLogoReply('{"found": true, "marks": ["Amazon smile"], "confidence": "low"}')
  check('an unsure find that NAMES a mark is shown', named.verdict === 'found', named.verdict)
}

// ── clean is clean ────────────────────────────────────────────────────────
{
  const d = readLogoReply('{"found": false, "marks": [], "confidence": "high"}')
  check('a no is clean', d.verdict === 'clean', d.verdict)
  check('and names nothing', d.marks.length === 0)
}

// ── THE ONE THAT MATTERS: nothing is ever silently passed ─────────────────
{
  const junk: Array<[string | null | undefined, string]> = [
    [null, 'no reply at all'],
    [undefined, 'undefined'],
    ['', 'an empty string'],
    ['I could not see the image', 'prose with no JSON'],
    ['{"found":', 'truncated JSON'],
    ['{"marks": ["Amazon"]}', 'JSON with no found field'],
    ['{"found": "yes"}', 'found as a string rather than a boolean'],
    ['[]', 'the wrong shape entirely'],
  ]
  for (const [raw, why] of junk) {
    const d = readLogoReply(raw)
    check(`${why} is not treated as clean`, d.verdict !== 'clean', `${why} → ${d.verdict}`)
    check(`${why} is not treated as a find`, d.verdict !== 'found', `${why} → ${d.verdict}`)
    check(`${why} gives a reason`, !!d.reason, why)
  }
}

// ── the prompt draws the line that matters ────────────────────────────────
//
// "Does this contain a logo" would catch the product's own brand mark, which is
// meant to be there and is in nearly every product thumbnail. The retailer /
// manufacturer distinction has to be in the prompt, because no amount of
// reading the answer can recover it afterwards.
{
  for (const term of ['Amazon', 'Walmart', 'Target', 'eBay', "Amazon's Choice"]) {
    check(`the prompt names ${term}`, LOGO_SCAN_PROMPT.includes(term))
  }
  check('and the smile symbol on its own', /smile or curved-arrow/i.test(LOGO_SCAN_PROMPT))
  check('the product\'s own maker is explicitly excluded',
    /company that MAKES the product/i.test(LOGO_SCAN_PROMPT),
    'without this every thumbnail with a brand on the box comes back as a hit')
  check('and so are platform logos',
    /YouTube, TikTok or Instagram/i.test(LOGO_SCAN_PROMPT),
    'a CTA sticker carries one deliberately')
  check('and the creator\'s own branding', /creator's own branding/i.test(LOGO_SCAN_PROMPT))
  check('an unsure answer is told to say no',
    /unsure, set found to false/i.test(LOGO_SCAN_PROMPT),
    'the default has to be the one that does not waste the creator\'s time')
  check('and the reply shape is pinned', /"found": true\|false/.test(LOGO_SCAN_PROMPT))
}

// ── the summary never claims a clean sweep it did not do ──────────────────
{
  const f = (verdict: LogoFinding['verdict']): LogoFinding => ({ verdict, marks: [] })

  const allClean = summariseLogoScan([f('clean'), f('clean'), f('clean')])
  check('a real clean sweep says so', /no store logos on any of them/i.test(allClean.headline), allClean.headline)
  check('and counts them', allClean.clean === 3)

  const mixed = summariseLogoScan([f('clean'), f('clean'), f('unreadable')])
  check('an unreadable one is NOT swept under a clean result',
    /could not be opened/i.test(mixed.headline), mixed.headline)
  check('and the clean claim is scoped to what was opened',
    /in the 2 thumbnails we could open/i.test(mixed.headline), mixed.headline)
  check('and it does not read as an all clear',
    !/no store logos on any of them/i.test(mixed.headline), mixed.headline)

  const noneOpened = summariseLogoScan([f('unreadable'), f('unreadable')])
  check('nothing opened says nothing was checked',
    /nothing was actually checked/i.test(noneOpened.headline), noneOpened.headline)
  check('and definitely does not read as clean',
    !/no store logos/i.test(noneOpened.headline) || /could not be opened|nothing was actually checked/i.test(noneOpened.headline),
    noneOpened.headline)

  const hit = summariseLogoScan([f('found'), f('clean'), f('unreadable')])
  check('a find leads, whatever else is in the batch', /have a store's logo|has a store's logo/i.test(hit.headline), hit.headline)
  check('one find is singular', /1 thumbnail has a store's logo/i.test(summariseLogoScan([f('found')]).headline))

  const empty = summariseLogoScan([])
  check('an empty batch is its own answer', /no thumbnails to check/i.test(empty.headline), empty.headline)
  check('and is not a clean bill of health', !/no store logos on any/i.test(empty.headline), empty.headline)
}

// ── house style ───────────────────────────────────────────────────────────
{
  const f = (verdict: LogoFinding['verdict']): LogoFinding => ({ verdict, marks: [] })
  const lines = [
    summariseLogoScan([f('clean')]).headline,
    summariseLogoScan([f('found')]).headline,
    summariseLogoScan([f('clean'), f('unreadable')]).headline,
    summariseLogoScan([f('unreadable')]).headline,
    summariseLogoScan([]).headline,
    readLogoReply(null).reason ?? '',
  ]
  for (const l of lines) {
    check(`no dash punctuation in "${l.slice(0, 40)}…"`, !/[—–]|\s-\s/.test(l))
    check(`no year in "${l.slice(0, 40)}…"`, !/\b20\d{2}\b/.test(l))
  }
}

if (failures.length) {
  console.error(`\n❌ logo-scan: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ logo-scan: found, clean and could-not-check stay three different answers')
