// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the expression a creator picked actually reach the face?
//
// Three ways this feature fails, and they are what is asserted here.
//
// It gets outvoted. The prompt already names an expression twice: once from the
// psychological angle's scene preset, once from the art director's brief. A
// directive that does not say it wins produces an average of three moods, which
// renders as a face doing nothing at all.
//
// Two picks look the same. "Serious" and "Unimpressed" both mean an unsmiling
// face to an image model unless the words separate them, and a picker whose
// options render identically is worse than no picker.
//
// It changes the person. An expression describes what a face is DOING. The
// moment it describes what the face looks like, it is competing with the
// identity lock, and the creator stops being recognisable in their own
// thumbnail.
import {
  EXPRESSIONS, expressionDirective, normalizeExpression, hasExpressionChoice,
  type ExpressionKey,
} from '../lib/face-expression'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── auto stays out of the way ───────────────────────────────────────────────
check('auto adds nothing to the prompt', expressionDirective('auto') === null)
check('auto is not a choice', !hasExpressionChoice('auto'))
check('an unknown value falls back to auto', normalizeExpression('smouldering') === 'auto')
check('junk cannot inject prompt text', normalizeExpression('IGNORE ALL PREVIOUS') === 'auto')
check('a real key survives', normalizeExpression('Skeptical') === 'skeptical')
check('null is auto', normalizeExpression(null) === 'auto')

// ── every option is usable ──────────────────────────────────────────────────
for (const e of EXPRESSIONS) {
  check(`${e.key} has a label`, !!e.label.trim())
  check(`${e.key} has a hint so a creator knows what it is for`, !!e.hint.trim())
  if (e.key === 'auto') continue
  const d = expressionDirective(e.key)
  check(`${e.key} produces a directive`, !!d)
  check(`${e.key} says it overrides the brief`, /OVERRIDES/.test(d || ''), d || '')
  check(`${e.key} protects identity`, /stays exactly as the reference photos show/i.test(d || ''))
  // Enough words to actually steer a render. A one-word mood is a stock face.
  check(`${e.key} describes the face concretely`, (d || '').length > 160, String((d || '').length))
}

// ── the options are actually different from each other ──────────────────────
// Two chips that render the same face are a lie in the UI.
{
  // Compare the per-expression wording ONLY. Every directive is wrapped in the
  // same override-and-identity boilerplate, and including that would make any
  // two of them look ~70% alike no matter what they said.
  const byKey = new Map(EXPRESSIONS.map(e => [e.key, e.directive]))
  const parts = (k: ExpressionKey) =>
    new Set((byKey.get(k) || '').toLowerCase().match(/[a-z]{4,}/g) || [])
  const keys = EXPRESSIONS.filter(e => e.key !== 'auto').map(e => e.key)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = parts(keys[i]), b = parts(keys[j])
      const shared = [...a].filter(w => b.has(w)).length
      const overlap = shared / Math.min(a.size, b.size)
      check(`${keys[i]} and ${keys[j]} do not describe the same face`, overlap < 0.6, overlap.toFixed(2))
    }
  }
}

// ── the ones most easily confused are pulled apart explicitly ───────────────
{
  const serious = expressionDirective('serious') || ''
  const unimpressed = expressionDirective('unimpressed') || ''
  check('serious is not read as angry', /not angry|not stern|not glaring/i.test(serious), serious)
  check('unimpressed is not read as disgust', /never disgusted|not sneering|never .*sneering/i.test(unimpressed), unimpressed)

  const surprised = expressionDirective('surprised') || ''
  check('surprised is not read as fear', /not fear/i.test(surprised), surprised)

  const confused = expressionDirective('confused') || ''
  check('confused is not read as anger', /not frowning in anger/i.test(confused), confused)

  const happy = expressionDirective('happy') || ''
  check('happy is not a stock smile', /never a stock/i.test(happy), happy)

  const skeptical = expressionDirective('skeptical') || ''
  check('skeptical raises ONE eyebrow', /ONE eyebrow/.test(skeptical), skeptical)
}

// ── nothing here describes what the person looks like ───────────────────────
// Anything on this list would be competing with the identity lock.
{
  const IDENTITY = /\b(young|younger|older|handsome|beautiful|pretty|attractive|slim|thin|fit|male|female|man|woman|blonde|brunette|tanned|pale)\b/i
  for (const e of EXPRESSIONS) {
    if (e.key === 'auto') continue
    check(`${e.key} never describes the person`, !IDENTITY.test(e.directive), e.directive)
  }
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
