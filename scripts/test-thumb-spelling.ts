// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A THUMBNAIL THAT MISSPELLS ITS OWN HEADLINE.
//
// Reported by a creator: a thumbnail meant to read DOES LIGHT REALLY DANCE
// THROUGH IT went out saying REALL. She could not fix it either, because there
// is no way to regenerate a blog post's featured thumbnail on its own.
//
// AN IMAGE MODEL DRAWS LETTERS, IT DOES NOT TYPE THEM. Nothing was
// misunderstood, so no rewording of the prompt fixes it: the render is a
// sample and some samples drop a letter. The same reasoning the garment check
// already runs on, and the same answer, a fraction of a cent to look at the
// result rather than an afternoon arguing with a sentence.
//
// This is also the most expensive defect the pipeline can ship. A wrong garment
// is arguable; a misspelling is the one thing every viewer notices and the only
// one that makes a channel look careless.
import { readFileSync } from 'node:fs'
import { parseReadBack, readBackRetryNote, keepRetry } from '../lib/thumb-read-back'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ROUTE = live(read('app/api/youtube/generate-thumbnail/route.ts'))
const LIB = live(read('lib/thumb-read-back.ts'))

// ── every word is read back off the image (Seb, 2026-10-19) ────────────────
// The first version judged the big headline alone, and a chip reading
// "Q12.2 25W" went out unread. The reader now gets everything the design was
// meant to carry and leaves out only the product's own printing.
{
  check('there is a read back', /async function textSpelledRight/.test(ROUTE))
  check('and it is called on the face render and the product-only render',
    /await textSpelledRight\(\{ renderB64: b64, \.\.\.want \}\)/.test(ROUTE)
    && /await textSpelledRight\(\{ renderB64: b64, \.\.\.wantP \}\)/.test(ROUTE),
    'a checker nothing calls is a comment')
  check('it is given the headline, the one extra and the call to action',
    /headline: \[line1, line2\]\.filter\(Boolean\)\.join\(' '\)/.test(ROUTE) && /extra: gfxBadge \|\|/.test(ROUTE) && /cta: hasCta/.test(ROUTE))
  check('it reads every word but the product\'s own printing',
    /Read EVERY piece of text/.test(LIB) && /Leave out only words printed on the product itself/.test(LIB))
  check('the old headline-only reader is gone', !/headlineSpelledRight|Judge the big headline alone/.test(ROUTE))
}

// ── a wrong one is re-rendered, once, and the retry is checked too ──────────
{
  check('a misspelling triggers one re-render',
    /if \(spell\.ok === false\)/.test(ROUTE) && /readBackRetryNote\(spell/.test(ROUTE),
    'reporting it without fixing it leaves the creator doing the work')
  check('the second render is checked before it is kept',
    /const second = await textSpelledRight\(\{ renderB64: retry/.test(ROUTE)
    && /if \(keepRetry\(spell, second\)\)/.test(ROUTE),
    'a retry that misspells a different word is not an improvement')
  check('and the first is kept when the retry is no better',
    /kept the first render/.test(ROUTE))
  check('a wrong chip the creator did not type is left out on the retry, not tried again',
    /const dropExtra = \(spell\.extraWrong \|\| spell\.strayWrong\) && !extraTyped/.test(ROUTE)
    && /extra: dropExtra \? '' : want\.extra/.test(ROUTE))
  {
    const from = ROUTE.indexOf('if (spell.ok === false)')
    const to = ROUTE.indexOf('await garmentMatchesProduct(')
    const body = from > -1 && to > from ? ROUTE.slice(from, to) : ''
    check('and only once',
      body.length > 0 && (body.match(/generateWithReferences/g) ?? []).length === 1,
      `a loop here bills for every sample it takes (${(body.match(/generateWithReferences/g) ?? []).length} renders in the block)`)
  }
  check('the product-only re-render runs only with time left for it',
    /spellP\.ok === false && Date\.now\(\) - requestStarted < PRODUCT_RETRY_BEFORE_MS/.test(ROUTE),
    'a second full render there was a main cause of the 240s client timeout')
  check('text still wrong is sent to the page, saying whether a second try was made',
    (ROUTE.match(/textStillWrong: stillWrong\(/g) ?? []).length === 2
    && /even after MVP made it a second time/.test(ROUTE) && /no time left to make it again/.test(ROUTE))
  check('and Co-Pilot shows it', /data\.textStillWrong/.test(read('app/(dashboard)/co-pilot/page.tsx')))
}

// ── the verdicts themselves ────────────────────────────────────────────────
{
  const want = { headline: 'DOES LIGHT REALLY DANCE', extra: '7 COLOURS' }
  const wrong = parseReadBack('{"headline":"DOES LIGHT REALL DANCE","headlineSame":false,"extra":"7 COLOURS","extraSame":true,"other":[],"otherBad":false}', want)
  check('a dropped letter in the headline is caught', wrong.ok === false && wrong.headlineWrong && /REALL/.test(wrong.problems[0]))
  const chip = parseReadBack('{"headline":"DOES LIGHT REALLY DANCE","headlineSame":true,"extra":"Q12.2 25W","extraSame":false,"other":[],"otherBad":false}', want)
  check('a wrong chip is caught too', chip.ok === false && chip.extraWrong && !chip.headlineWrong)
  const stray = parseReadBack('{"headline":"DOES LIGHT REALLY DANCE","headlineSame":true,"extra":"","extraSame":null,"other":["ULTRA BRIGTH"],"otherBad":true}', want)
  check('garbled extra text is caught', stray.ok === false && stray.strayWrong)
  const fine = parseReadBack('{"headline":"DOES LIGHT REALLY DANCE","headlineSame":true,"extra":"7 COLOURS","extraSame":true,"other":[],"otherBad":false}', want)
  check('a clean render passes', fine.ok === true && fine.problems.length === 0)
  check('an unreadable answer is unknown, never a failure',
    parseReadBack('sorry', want).ok === null && parseReadBack('{"headlineSame":"maybe"}', want).ok === null)
  const note = readBackRetryNote(chip, { extraTyped: false })
  check('the retry for a wrong chip leaves the chip out', /leave out the small badge or chip entirely/.test(note))
  check('but keeps a badge the creator typed', !/leave out the small badge/.test(readBackRetryNote(chip, { extraTyped: true })))
  check('a retry that is wrong in fewer places is kept, one wrong in more is not',
    keepRetry({ ...wrong, problems: ['a', 'b'] }, { ...wrong, problems: ['a'] }) && !keepRetry(wrong, { ...wrong, problems: ['a', 'b'] }))
  check('an unknown verdict on the retry keeps the retry', keepRetry(wrong, { ...wrong, ok: null }))
}

// ── it never breaks the thing it guards ─────────────────────────────────────
{
  check('a checker that fails returns unknown, not a verdict',
    /catch \(e\) \{\s*console\.warn\('\[spell-check\] skipped:'[\s\S]{0,80}return unknown/.test(ROUTE),
    'a thumbnail must still ship when the checker is down')
  check('and unknown does not trigger a re-render',
    /spell\.ok === false/.test(ROUTE) && !/spell\.ok !== true/.test(ROUTE),
    'treating unknown as wrong would double the bill every time the checker hiccups')
  check('an empty headline is not checked at all',
    /if \(!opts\.headline\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\) return unknown/.test(ROUTE))
  check('the check is billed to the creator it ran for',
    /feature: 'yt_thumb_spell_check'/.test(ROUTE),
    'unattributed spend is spend nobody can explain later')
}

if (failures.length) {
  console.error(`\n❌ thumb-spelling: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ thumb-spelling: every word is read back off the image, and a misspelling is re-rendered once and checked again')
