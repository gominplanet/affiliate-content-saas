// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does a roundup cover as many products as it can explain, or as many as fit?
//
// Roundups were capped at twelve, and the twelve came from a slice:
//
//   const unique = [...new Set(asins)].slice(0, 12)
//
// Nothing asked whether there was enough to SAY about twelve things. Twelve
// products in a nine hundred word post is about seventy words each, which is a
// caption. A reader choosing between twelve options learns nothing from seventy
// words each, and a page that lists twelve products and explains none of them is
// an easy call for Google. On one MVP site that call had been made 394 times.
//
// So the count is an output now, not an input, and the picks that did not make
// it are reported. A creator who selected twelve deals and sees five in the
// finished post is owed the reason.
import {
  planProductDepth, depthToPrompt, MIN_WORDS_PER_PRODUCT, FRAMING_WORDS,
} from '../lib/product-depth'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the failure this file exists for ────────────────────────────────────────
// Twelve deals, a 900 word budget. The old code shipped all twelve.
{
  const p = planProductDepth({ candidates: 12, maxWords: 900, requested: 12 })
  check('twelve products do not fit in nine hundred words', p.count < 12, `${p.count}`)
  check('and each survivor clears the floor', p.wordsEach >= MIN_WORDS_PER_PRODUCT,
    `${p.wordsEach} words each`)
  check('the creator is told how many were cut', p.dropped === 12 - p.count, `${p.dropped}`)
  check('and told why, in terms of what the reader would have got',
    !!p.note && /caption rather than a recommendation/.test(p.note), p.note ?? 'no note')
  check('the note states both numbers so it can be checked',
    !!p.note && p.note.includes('12') && p.note.includes(String(p.count)), p.note ?? '')
  check('and says what would raise the number',
    !!p.note && /longer video/.test(p.note), p.note ?? '')
}

// ── a long post genuinely can carry more ────────────────────────────────────
// The rule is depth, not a smaller cap dressed up as one.
{
  const deep = planProductDepth({ candidates: 12, maxWords: 3200, requested: 12 })
  const thin = planProductDepth({ candidates: 12, maxWords: 900, requested: 12 })
  check('a deep post carries more products than a short one', deep.count > thin.count,
    `${deep.count} vs ${thin.count}`)
  check('and every one still clears the floor', deep.wordsEach >= MIN_WORDS_PER_PRODUCT,
    `${deep.wordsEach}`)
}

// ── never more than were asked for, or exist ────────────────────────────────
{
  const few = planProductDepth({ candidates: 3, maxWords: 3200, requested: 3 })
  check('a big budget does not invent products', few.count === 3, `${few.count}`)
  check('and nothing is reported as dropped', few.dropped === 0)
  check('so there is nothing to explain', few.note === null, few.note ?? '')

  const capped = planProductDepth({ candidates: 20, maxWords: 3200, requested: 5 })
  check('an explicit request is respected as a ceiling', capped.count === 5, `${capped.count}`)
}

// ── the floor cannot be lowered ─────────────────────────────────────────────
// Raising it is a judgement call. Lowering it is the thing this module exists
// to stop, so a caller passing a smaller number gets the default instead.
{
  const sneaky = planProductDepth({ candidates: 12, maxWords: 900, requested: 12, minWordsEach: 40 })
  check('a caller cannot lower the per-product floor',
    sneaky.minWordsEach === MIN_WORDS_PER_PRODUCT, `${sneaky.minWordsEach}`)
  const raised = planProductDepth({ candidates: 12, maxWords: 3200, requested: 12, minWordsEach: 500 })
  check('but can raise it', raised.minWordsEach === 500, `${raised.minWordsEach}`)
  check('and raising it lowers the count', raised.count < 12, `${raised.count}`)
}

// ── a post always covers something ──────────────────────────────────────────
{
  const tiny = planProductDepth({ candidates: 5, maxWords: 100, requested: 5 })
  check('a tiny budget still produces a post', tiny.count >= 1, `${tiny.count}`)
  check('covering one product rather than none', tiny.count === 1, `${tiny.count}`)
  check('and the shortfall is admitted', !!tiny.note, tiny.note ?? 'no note')
}

// ── what the post actually is, once the count is known ──────────────────────
// Three products is a comparison. Calling it a roundup promises a breadth the
// page does not have.
{
  check('one product is a single', planProductDepth({ candidates: 1, maxWords: 2000 }).kind === 'single')
  check('three is a comparison',
    planProductDepth({ candidates: 3, maxWords: 2000, requested: 3 }).kind === 'comparison',
    planProductDepth({ candidates: 3, maxWords: 2000, requested: 3 }).kind)
  check('eight is a roundup',
    planProductDepth({ candidates: 8, maxWords: 3200, requested: 8 }).kind === 'roundup',
    planProductDepth({ candidates: 8, maxWords: 3200, requested: 8 }).kind)
}

// ── framing is held back before the division ────────────────────────────────
// Otherwise the opening and the close get eaten by one more entry.
{
  const p = planProductDepth({ candidates: 50, maxWords: 1000 + FRAMING_WORDS, requested: 50 })
  check('the intro and close are not spent on products',
    p.count * p.wordsEach <= 1000, `${p.count} x ${p.wordsEach}`)
}

// ── malformed input never produces a broken plan ────────────────────────────
{
  for (const bad of [NaN, -5, undefined, null]) {
    const p = planProductDepth({
      candidates: bad as number, maxWords: bad as number, requested: bad as number,
    })
    if (!Number.isFinite(p.count) || p.count < 1 || !Number.isFinite(p.wordsEach) || p.wordsEach < 0) {
      check(`malformed input (${String(bad)}) still plans`, false, JSON.stringify(p))
      break
    }
  }
  check('no malformed input produces a broken plan', true)
}

// ── the floor must never become a reason to pad ─────────────────────────────
// This is the trap in the whole idea: a minimum word count per product is an
// invitation to invent two hundred words about a product with nothing behind it,
// which is the exact failure the source budget work removed this morning.
{
  const text = depthToPrompt(planProductDepth({ candidates: 6, maxWords: 3200, requested: 6 }))
  check('the writer is told the floor is not a quota',
    /not a quota to pad toward/.test(text), text)
  check('and told to cut a weak pick rather than fill it out',
    /A padded\s+entry is worse than a missing one/.test(text), text)
  check('the count is stated exactly', /EXACTLY 6/.test(text), text)
  check('and so is the floor', new RegExp(`${MIN_WORDS_PER_PRODUCT} words`).test(text), text)
  check('each entry is told what it must contain',
    /who should pick\s+it over the others/.test(text), text)
}

// ── a single-product post does not grow competitors ─────────────────────────
{
  const text = depthToPrompt(planProductDepth({ candidates: 1, maxWords: 2000 }))
  check('a one-product post says so', /covers ONE product/.test(text), text)
  check('and refuses to give an alternative its own section',
    /does not get its own section/.test(text), text)
}

// ── a comparison is written as a comparison ─────────────────────────────────
{
  const text = depthToPrompt(planProductDepth({ candidates: 3, maxWords: 2000, requested: 3 }))
  check('a small set is compared against itself, not reviewed in isolation',
    /rather than reviewing each in isolation/.test(text), text)
}

// ── the deal digest, which was the thinnest thing MVP publishes ─────────────
// Twelve deals at "2 short sentences each" is a four hundred word page listing
// twelve products and explaining none of them.
{
  const strip = (x: string) => x.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const DIGEST = strip(readFileSync(join(__dirname, '..', 'lib/weekly-digest.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // 2 short sentences each\nreal code').indexOf('2 short sentences') === -1)
  check('the digest no longer asks for two sentences per deal',
    !/2 short sentences each/.test(DIGEST),
    'thirty words cannot say what it is, why the price matters, and who it suits')
  check('it states a computed floor instead',
    /AT LEAST \$\{depth\.minWordsEach\} words each/.test(DIGEST))
  check('and the count comes from the budget',
    /planProductDepth\(\{/.test(DIGEST) && /contentKind: 'deal'/.test(DIGEST))
  check('a deal entry uses the deal floor, not the review one',
    /contentKind: 'deal'/.test(DIGEST),
    'forcing review depth on a weekly list makes something nobody finishes')
  check('the response has room for real entries',
    !/max_tokens: 1000,/.test(DIGEST), 'a 1000 token cap cannot hold the longer blurbs')
  check('and the floor is still not a licence to pad',
    /Do not pad to reach the length/.test(DIGEST))
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. A fixed cap that ignores the word budget.
  broke('a fixed twelve on a short post is caught',
    planProductDepth({ candidates: 12, maxWords: 900, requested: 12 }).count < 12)

  // Break 2: dropping picks silently, which makes MVP look broken.
  broke('a silent trim is caught',
    planProductDepth({ candidates: 12, maxWords: 900, requested: 12 }).note !== null)

  // Break 3: letting a caller lower the floor, which reopens the whole problem.
  broke('a lowered floor is caught',
    planProductDepth({ candidates: 12, maxWords: 900, requested: 12, minWordsEach: 40 })
      .minWordsEach === MIN_WORDS_PER_PRODUCT)

  // Break 4: a count that ignores the budget entirely and always returns the ask.
  broke('a count that always equals the request is caught',
    planProductDepth({ candidates: 20, maxWords: 600, requested: 20 }).count < 20)

  // Break 5: spending the framing budget on an extra product.
  const p = planProductDepth({ candidates: 50, maxWords: 1000 + FRAMING_WORDS, requested: 50 })
  broke('framing eaten by an extra entry is caught', p.count * p.wordsEach <= 1000)

  // Break 6: a zero or negative count, which would produce a post about nothing.
  broke('a zero count is caught',
    planProductDepth({ candidates: 0, maxWords: 0, requested: 0 }).count >= 1)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ product-depth: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ product-depth: a post covers as many products as it can explain, and says what it cut')
