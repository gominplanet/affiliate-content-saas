// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The portrait prompt, read the way the model reads it.
//
// The whole expression feature now rests on this one image: the design step
// copies the face it is handed, faithfully and by design, so a portrait that
// comes back with a polite smile makes a thumbnail with a polite smile no
// matter what the creator picked.
//
// The failure this locks out is about ORDER, not wording. The first version
// opened with a long emphatic "reproduce their facial identity exactly" and put
// the expression three paragraphs down. Handed a photo and told first and at
// length to reproduce it, an image-to-image model copies the photo, expression
// and all. Both instructions are needed; only one can be the subject, and it has
// to be the thing we are trying to change.
import { buildExpressionPortraitPrompt } from '../lib/expression-portrait'
import { EXPRESSIONS } from '../lib/face-expression'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

check('auto asks for no portrait at all', buildExpressionPortraitPrompt('auto') === null)

for (const e of EXPRESSIONS) {
  if (e.key === 'auto') continue
  const p = buildExpressionPortraitPrompt(e.key)
  if (!p) { failures.push(`${e.key} produced no prompt`); continue }

  // ── the expression is the subject, not a footnote ──────────────────────────
  // Case-insensitive: the prompt capitalises the first letter when it inserts
  // the description as a sentence of its own.
  const exprAt = p.toLowerCase().indexOf(e.directive.slice(0, 40).toLowerCase())
  const identityAt = p.indexOf('WHO the person is comes from')
  check(`[${e.key}] the expression is stated before the identity constraint`,
    exprAt > 0 && exprAt < identityAt, `expression@${exprAt} identity@${identityAt}`)
  check(`[${e.key}] the first line frames the task as an expression`,
    /MAKING A SPECIFIC FACIAL EXPRESSION/.test(p.split('\n')[0]), p.split('\n')[0].slice(0, 80))
  check(`[${e.key}] it appears in the first quarter of the prompt`,
    exprAt < p.length / 4, `${exprAt} of ${p.length}`)

  // ── nothing tells it to keep the face as it is ────────────────────────────
  // Every version of this bug has been a sentence somewhere pinning the face.
  check(`[${e.key}] nothing says to reproduce the face exactly`,
    !/reproduce (their|the) facial identity exactly/i.test(p), 'that instruction makes it copy the photo')
  check(`[${e.key}] nothing pins the mouth or eyes shut`,
    !/same lip shape|same eye shape|resting expression/i.test(p))
  check(`[${e.key}] it says explicitly not to copy the reference expression`,
    /Do NOT copy the expression/.test(p))
  check(`[${e.key}] and explains that shape means proportion, not position`,
    /proportion of those features at rest/.test(p))

  // ── the fallback failure is named so it stops being the safe answer ───────
  check(`[${e.key}] the polite-smile default is called out as wrong`,
    /polite closed-mouth smile[\s\S]*WRONG answer/.test(p))

  // ── it carries a face and nothing else ───────────────────────────────────
  // A portrait that invents an outfit dresses the person in the design that
  // follows, fighting the product they are supposed to be wearing.
  check(`[${e.key}] no clothing may appear`, /NO clothing, NO collar, NO shoulders, NO torso/.test(p))
  check(`[${e.key}] and it says why that matters`, /would compete with it/.test(p))

  // ── identity is still required ───────────────────────────────────────────
  check(`[${e.key}] identity is still locked`, /recognise them instantly/.test(p))
  check(`[${e.key}] one person only`, /no second person/.test(p))
  check(`[${e.key}] nothing rendered as undefined`, !/undefined|\[object Object\]/.test(p))
}

// ── the design-brief wrapper does not leak in ───────────────────────────────
// expressionDirective() is written to win an argument inside a thumbnail brief.
// In a portrait there is no other brief to override, so that framing is noise
// diluting the only sentence that matters.
for (const e of EXPRESSIONS) {
  if (e.key === 'auto') continue
  const p = buildExpressionPortraitPrompt(e.key) || ''
  check(`[${e.key}] no design-brief framing leaks into the portrait`,
    !/OVERRIDES any other expression/.test(p) && !/in this brief/.test(p))
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
