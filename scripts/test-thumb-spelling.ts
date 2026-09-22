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

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ROUTE = live(read('app/api/youtube/generate-thumbnail/route.ts'))

// ── the headline is read back off the image ─────────────────────────────────
{
  check('there is a spelling check',
    /async function headlineSpelledRight/.test(ROUTE),
    'no amount of "spell it correctly" in a prompt fixes a renderer that drops a letter')
  check('and it is actually called on the render',
    /await headlineSpelledRight\(\{ renderB64: b64/.test(ROUTE),
    'a checker nothing calls is a comment')
  check('it is given the headline that was asked for',
    /const want = \[line1, line2\]/.test(ROUTE),
    'checking against nothing cannot tell right from wrong')
  check('it looks at the big headline, not every word in the frame',
    /Judge the big headline alone/.test(ROUTE),
    'badges and product packaging carry text we never wrote and cannot control')
}

// ── a wrong one is re-rendered, once, and the retry is checked too ──────────
{
  check('a misspelling triggers one re-render',
    /if \(spell\.ok === false\)/.test(ROUTE) && /MISSPELLED THE HEADLINE/.test(ROUTE),
    'reporting it without fixing it leaves the creator doing the work')

  // THE RETRY IS A FRESH SAMPLE, NOT A SMARTER ATTEMPT, so it can be wrong in a
  // new way. Swapping it in unchecked is the plan reported as the result.
  check('the second render is checked before it is kept',
    /const second = await headlineSpelledRight\(\{ renderB64: retry/.test(ROUTE)
    && /if \(second\.ok !== false\) b64 = retry/.test(ROUTE),
    'a retry that misspells a different word is not an improvement')
  check('and the first is kept when the retry is no better',
    /kept the first render/.test(ROUTE),
    'replacing a bad image with an equally bad one spends money for nothing')

  // ONLY ONCE. Two retries turn a bad afternoon into a bill, which is the
  // reasoning the garment check already settled on.
  {
    const at = ROUTE.indexOf('async function headlineSpelledRight')
    // SLICED BETWEEN TWO LINES OF CODE. The first version ended the slice at a
    // COMMENT, and live() strips comments, so indexOf returned -1 and the
    // slice ran to the end of the file and counted every render in it.
    const from = ROUTE.indexOf('if (spell.ok === false)')
    const to = ROUTE.indexOf('await garmentMatchesProduct(')
    const body = from > -1 && to > from ? ROUTE.slice(from, to) : ''
    check('and only once',
      body.length > 0 && (body.match(/generateWithReferences/g) ?? []).length === 1,
      `a loop here bills for every sample it takes (${(body.match(/generateWithReferences/g) ?? []).length} renders in the block)`)
    check('the helper exists above its use', at > -1)
  }
}

// ── it never breaks the thing it guards ─────────────────────────────────────
{
  check('a checker that fails returns unknown, not a verdict',
    /ok: null, got: '', reason: 'check unavailable'/.test(ROUTE),
    'a thumbnail must still ship when the checker is down')
  check('and unknown does not trigger a re-render',
    /spell\.ok === false/.test(ROUTE) && !/spell\.ok !== true/.test(ROUTE),
    'treating unknown as wrong would double the bill every time the checker hiccups')
  check('an empty headline is not checked at all',
    /if \(!expected\) return \{ ok: null/.test(ROUTE),
    'there is nothing to spell wrong on a wordless thumbnail')
  check('the check is billed to the creator it ran for',
    /feature: 'yt_thumb_spell_check'/.test(ROUTE),
    'unattributed spend is spend nobody can explain later')
}

if (failures.length) {
  console.error(`\n❌ thumb-spelling: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ thumb-spelling: the headline is read back off the image, and a misspelling is re-rendered once and checked again')
