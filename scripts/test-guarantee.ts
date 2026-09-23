// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PROMISE ON A SALES PAGE IS IN THE TERMS, OR IT IS NOT MADE.
//
// WHAT WAS LIVE. /own-your-blog and /run-your-storefront promised a "30-day
// money-back guarantee" five times between them: twice directly under a
// checkout button, once as an FAQ answer ending "no questions", and twice as
// a tile reading "30-day guarantee · If it is not for you, you get your money
// back." Section 9 of the Terms of Service, the document a buyer agrees to at
// checkout, said the opposite in one line:
//
//     Fees already paid are non-refundable except where required by law.
//
// WHAT ITS FAILURE LOOKED LIKE ON SCREEN. Nothing, which is why it lasted.
// Each page reads perfectly on its own. Nobody opens clause 9 beside a
// landing page before paying. The contradiction becomes visible at exactly
// one moment: when somebody asks for their money back and we have to decide
// which of our own documents to honour. Whichever way that goes, it goes
// badly, and it goes badly in writing.
//
// The operator confirmed on 2026-09-23 that the guarantee is real, so the
// Terms carry it now.
//
// THE RULE THIS FILE ENFORCES is narrow and worth stating plainly: if a page
// that sells a subscription promises a refund, the Terms must promise one
// too, and both must mean the same number of days. It does not police the
// wording, only that neither side can exist without the other.

import { readFileSync } from 'node:fs'
import { GUARANTEE_DAYS, GUARANTEE_LABEL, GUARANTEE_SHORT } from '../lib/guarantee'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l)).join('\n')

/** live(), minus the import lines.
 *
 *  THIS IS NOT FUSSINESS. Two of the mutations written to break this file
 *  passed it the first time for exactly one reason: `import { GUARANTEE_DAYS,
 *  GUARANTEE_LABEL }` is still at the top of a file whose body has stopped
 *  using either. A guard satisfied by an import is a guard that checks the
 *  page still knows the constant exists, which is not the question. */
const body = (src: string) => live(src)
  .split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')

const TERMS = body(read('app/terms/page.tsx'))
const SELLING = [
  'app/own-your-blog/page.tsx',
  'app/run-your-storefront/page.tsx',
]

// ── the constant is sane ───────────────────────────────────────────────────
{
  check('the window is a real number of days',
    Number.isInteger(GUARANTEE_DAYS) && GUARANTEE_DAYS > 0,
    `got ${GUARANTEE_DAYS}`)
  check('and both phrasings carry it',
    GUARANTEE_LABEL.includes(String(GUARANTEE_DAYS)) && GUARANTEE_SHORT.includes(String(GUARANTEE_DAYS)),
    `"${GUARANTEE_LABEL}" / "${GUARANTEE_SHORT}" — a label that has lost its number cannot be checked against the terms`)
}

// ── the terms make the promise, and for the same window ────────────────────
{
  check('the Terms carry a refund clause',
    /refund/i.test(TERMS),
    'a guarantee absent from the document a buyer agrees to is a guarantee we would have to argue about')
  check('and it is not the old flat refusal',
    !/Fees already paid are non-refundable\s*$/m.test(TERMS)
    && !/paid are non-refundable\s+except where required by law\.\s*<\/p>/.test(TERMS.replace(/\s+/g, ' ')),
    'this sentence and the sales pages cannot both be true')
  check('the Terms read the window rather than typing it',
    /GUARANTEE_DAYS/.test(TERMS) && /from '@\/lib\/guarantee'/.test(read('app/terms/page.tsx')),
    'two typed numbers is how 30 on the page becomes 14 in the terms')
  check('and the clause types no day count of its own',
    !/\b\d+\s*(?:-day|days)\b/.test(TERMS.slice(
      Math.max(0, TERMS.indexOf('money-back') - 400),
      TERMS.indexOf('money-back') + 900)),
    'a hand-typed window beside an interpolated one is the drift, not the fix')

  // The refusal still has to survive SOMEWHERE, because it is true of
  // everything the guarantee does not cover. What must not survive is a
  // blanket version with no exception carved out of it.
  check('renewals and used credits are still excluded in writing',
    /renewals/i.test(TERMS) && /credit packs/i.test(TERMS),
    'an unbounded "we refund anything" is a different liability from the one that was agreed')
}

// ── every page that promises it points at the same constant ────────────────
{
  for (const f of SELLING) {
    const src = read(f)
    const used = body(src)
    const promises = /money-back|money back|GUARANTEE_LABEL|GUARANTEE_SHORT/.test(used)
    if (!promises) continue

    check(`${f} reads the guarantee from lib/guarantee`,
      /from '@\/lib\/guarantee'/.test(src),
      'a page that promises a refund in its own words is a page the terms cannot follow')
    check(`${f} types no window of its own`,
      !/\b\d+-day money-back/.test(used) && !/\b\d+-day guarantee/.test(used),
      'the number belongs in one file')
  }

  // AND THE PAGES DID NOT QUIETLY STOP PROMISING IT. Deleting the claim is a
  // legitimate way to end the contradiction, but it is a decision, not a
  // side effect, and this asserts the decision that was actually made.
  const promising = SELLING.filter((f) => /GUARANTEE_LABEL|GUARANTEE_SHORT/.test(body(read(f))))
  check('both sales pages still make the promise',
    promising.length === SELLING.length,
    `only ${promising.join(', ') || 'none'} — the operator confirmed the guarantee is real, so a page dropping it is a regression, not a fix`)
}

if (failures.length) {
  console.error(`\n❌ guarantee: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ guarantee: the refund promised on the sales pages is the one in the terms, for the same number of days')
