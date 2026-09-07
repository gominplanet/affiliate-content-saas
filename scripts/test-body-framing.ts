// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Framing, and the contradiction it is most likely to introduce.
//
// Every prompt bug on this feature has had one shape: two sentences telling the
// image model opposite things about the same subject, hundreds of lines apart,
// with the later or more concrete one quietly winning.
//
//   "plain and neutral"            beat  a navy cable-knit polo
//   "content-fitting expression"   beat  the creator's chosen expression
//   the reference selfie's shirt   beat  the product photo
//
// A framing toggle is a fourth one waiting to happen, because the sentence it
// replaces is emphatic and absolute: "do NOT invent or show their full body,
// legs, waist-down, or overall body build". Ask for a full-body shot while that
// survives anywhere in the prompt and you get a cropped, hedged half-figure.
//
// So the rule under test is simple: there is exactly ONE framing sentence, and
// the two versions can never both be present.
import {
  BUILDS, HEIGHTS, autoFraming, resolveFraming, framingLine, framingNote,
  normalizeFraming, normalizeBuild, normalizeHeight,
  type BuildKey, type HeightKey,
} from '../lib/body-framing'
import type { ApparelKind } from '../lib/wear-product'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the two sentences are mutually exclusive, always ────────────────────────
const FORBIDS_BODY = /do NOT invent or show their full body/
const ASKS_FOR_BODY = /Show them FULL BODY/

for (const b of BUILDS) {
  for (const h of HEIGHTS) {
    for (const framing of ['bust', 'full'] as const) {
      const line = framingLine({ framing, build: b.key, height: h.key })
      const forbids = FORBIDS_BODY.test(line)
      const asks = ASKS_FOR_BODY.test(line)
      check(`[${framing}/${b.key}/${h.key}] exactly one framing instruction`,
        forbids !== asks, `forbids=${forbids} asks=${asks}`)
      check(`[${framing}/${b.key}/${h.key}] and it is the one that was requested`,
        asks === (framing === 'full'))
      check(`[${framing}/${b.key}/${h.key}] nothing renders as undefined`,
        !/undefined|\[object Object\]/.test(line), line)
    }
  }
}

// ── a full-body shot actually describes the body ────────────────────────────
// It is invented, so the words are the only thing deciding what it looks like.
// A line that silently drops the creator's pick renders a default stranger.
for (const b of BUILDS) {
  const line = framingLine({ framing: 'full', build: b.key, height: 'average' })
  check(`[${b.key}] the chosen build reaches the prompt`, line.includes(b.phrase), line.slice(0, 120))
}
for (const h of HEIGHTS) {
  const line = framingLine({ framing: 'full', build: 'average', height: h.key })
  check(`[${h.key}] the chosen height reaches the prompt`, line.includes(h.phrase), line.slice(0, 120))
}

{
  const line = framingLine({ framing: 'full', build: 'athletic', height: 'tall' })
  check('a full-body shot says the feet are in frame', /feet completely inside the frame/.test(line))
  check('and that the product below the waist is visible', /below the waist/.test(line),
    'the entire reason a creator picks this is a product a bust shot cannot show')
  check('and it still pins the face to the references',
    /face stays exactly as the references show it/.test(line),
    'a smaller face at full-body scale is exactly when identity drifts')
  check('and it admits the body is not documented',
    /not documented anywhere/.test(line),
    'the model should be told it is inventing, not left to think it is copying')
}

{
  const line = framingLine({ framing: 'bust' })
  check('a bust shot is unchanged from what shipped for a year',
    /HEAD-AND-SHOULDERS to roughly CHEST-UP only/.test(line) && FORBIDS_BODY.test(line))
  check('and it never mentions a build', !BUILDS.some(b => line.includes(b.phrase)),
    'build and height are meaningless when the body is not in frame, and a stray one is a contradiction')
}

// ── the default comes from the product, because some cases are impossible ───
// This is the silent hole the toggle exists to close: the wearable detector
// already said "worn on their feet" and the framing rule then forbade feet.
{
  const full: ApparelKind[] = ['bottom', 'shoes', 'socks', 'dress', 'swimwear']
  for (const k of full) {
    check(`${k} defaults to full body`, autoFraming(k) === 'full',
      'a bust shot physically cannot show this product')
  }
  const bust: ApparelKind[] = ['top', 'outerwear', 'hat', 'watch', 'eyewear', 'jewelry', 'scarf', 'gloves', 'bag']
  for (const k of bust) {
    check(`${k} stays a bust shot`, autoFraming(k) === 'bust',
      'these already worked, and a bust shot puts far more face on screen')
  }
  check('a product nobody wears stays a bust shot', autoFraming(null) === 'bust')
}

// ── the creator's pick always beats the category ────────────────────────────
{
  check('an explicit bust wins over shoes', resolveFraming('bust', 'shoes') === 'bust')
  check('an explicit full wins over a watch', resolveFraming('full', 'watch') === 'full')
  check('auto defers to the product', resolveFraming('auto', 'shoes') === 'full')
  check('and auto on a non-wearable is a bust shot', resolveFraming('auto', null) === 'bust')
}

// ── nothing arriving over HTTP can produce a broken prompt ──────────────────
{
  check('an unknown framing is auto', normalizeFraming('waist-up') === 'auto')
  check('null framing is auto', normalizeFraming(null) === 'auto')
  check('case does not matter', normalizeFraming('FULL') === 'full')
  check('an unknown build falls back to average', normalizeBuild('hulking') === 'average')
  check('an unknown height falls back to average', normalizeHeight('') === 'average')
  check('a real build survives', normalizeBuild('curvy') === 'curvy')
  check('a real height survives', normalizeHeight('short') === 'short')
  // Whatever comes back must always be usable, since it goes straight into a prompt.
  for (const junk of [null, undefined, 42, {}, 'DROP TABLE', '  Athletic  ']) {
    const line = framingLine({
      framing: 'full',
      build: normalizeBuild(junk) as BuildKey,
      height: normalizeHeight(junk) as HeightKey,
    })
    check(`junk input still builds a clean line (${String(junk)})`,
      !/undefined|null|\[object Object\]/.test(line), line.slice(0, 100))
  }
}

// ── the card never lets a drawn body pass for a photographed one ────────────
{
  check('a bust shot says nothing', framingNote('bust', 'average', 'average') === null)
  const n = framingNote('full', 'athletic', 'tall') || ''
  check('a full-body shot says the body is generated', /generated/.test(n), n)
  check('and names both settings it came from', /athletic/.test(n) && /tall/.test(n), n)
  check('and says MVP only has face photos', /only has photos of your face/.test(n), n)
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures.slice(0, 30)) console.log(`  ✗ ${f}`)
if (failures.length > 30) console.log(`  … and ${failures.length - 30} more`)
process.exit(failures.length ? 1 : 0)
