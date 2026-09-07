// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every scenario's FINAL prompt, checked for the bug that keeps happening.
//
// One afternoon produced four "fixes" to the thumbnail prompt. Every one of them
// was the same shape, and none of them was a missing instruction. They were
// CONTRADICTIONS: two sentences telling the image model opposite things about
// the same subject, where whichever was later or more concrete quietly won.
//
//   "plain and neutral"            beat  a navy cable-knit polo
//   "resting expression"           beat  "make them look excited"
//   "content-fitting expression"   beat  the creator's chosen expression
//   "same lip shape"               beat  "mouth open in a soft O"
//
// Reading the template never showed any of them, because the two halves lived
// hundreds of lines apart and only met in the assembled string. So this builds
// the real prompt for every combination of inputs that a creator can produce —
// 9 expressions, worn and not, with and without an art-director concept, with
// and without a product photo — and reads each one the way the model does.
//
// The rule this enforces: for each subject the model must be told exactly one
// thing. Not the loudest thing. One.
import {
  buildGraphicThumbnailPrompt, personActionLine, wardrobeLine, paletteLine,
  type ThumbnailPromptInput,
} from '../lib/thumbnail-prompt'
import { EXPRESSIONS, expressionDirective } from '../lib/face-expression'
import { wearDirective, detectWearable } from '../lib/wear-product'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `\n      ${detail}` : ''}`)
}

const POLO = detectWearable({ title: 'Gracyoga Men’s Polo Shirts Casual Knit Texture Collared Golf Shirt' })
const WEAR = wearDirective(POLO)

const base = (over: Partial<ThumbnailPromptInput> = {}): ThumbnailPromptInput => ({
  line1: 'IS THIS THE BEST',
  line2: 'POLO EVER???',
  concept: 'A bold golf-course scene, deep green and gold, the creator mid-reaction with a doubtful raised brow as he questions the hype.',
  palette: 'deep forest green with metallic gold',
  banner: 'SO SMOOTH!',
  callouts: ['KNIT TEXTURE', 'COLLARED FIT'],
  briefExpression: 'skeptical raised eyebrow',
  briefPose: 'pointing at the product',
  creatorRefLabel: 'Image 1 (close-up portrait photo)',
  identityInstruction: 'These are close-up portrait photos of the creator — use them for a strong face identity lock.',
  productRefNum: 2,
  productLabel: 'the polo shirt',
  outfitDirective: 'WARDROBE: vary what they are wearing so thumbnails do not repeat.',
  ...over,
})

/** Every combination a creator can actually produce on the Amazon builder. */
function* scenarios(): Generator<{ name: string; input: ThumbnailPromptInput }> {
  for (const e of EXPRESSIONS) {
    const expressionLine = expressionDirective(e.key)
    for (const worn of [true, false]) {
      for (const concept of [true, false]) {
        for (const inRef of expressionLine ? [true, false] : [false]) {
          // Only meaningful when the product is worn: it says whether the
          // creator's own clothes were cropped out of the identity references.
          for (const headOnly of worn ? [true, false] : [false]) {
            for (const framing of ['bust', 'full'] as const) {
              yield {
                name: `${e.key}${worn ? ' + worn' : ''}${concept ? ' + concept' : ' + fallback'}${inRef ? ' + posed-ref' : ''}${worn ? (headOnly ? ' + head-only refs' : ' + uncropped refs') : ''} + ${framing}`,
                input: base({
                  expressionLine,
                  expressionInReference: inRef,
                  wearLine: worn ? WEAR : null,
                  wearOn: worn ? POLO.on : null,
                  refsAreHeadOnly: headOnly,
                  framing,
                  build: 'athletic',
                  height: 'tall',
                  concept: concept ? base().concept : '',
                  palette: concept ? base().palette : '',
                }),
              }
            }
          }
        }
      }
    }
  }
}

const all = [...scenarios()]
console.log(`thumbnail prompt — ${all.length} scenarios\n`)

for (const { name, input } of all) {
  const p = buildGraphicThumbnailPrompt(input)
  const lower = p.toLowerCase()

  // ── 1. Nothing may flatten a worn product ─────────────────────────────────
  // The exact regression: "plain and neutral" in the wardrobe line landed on the
  // garment. Any of these words in a sentence that could be read as describing
  // the product is how a patterned item comes back blank.
  if (input.wearLine) {
    for (const [word, re] of [
      ['plain', /\bplain\b/g],
      ['neutral', /\bneutral\b/g],
      ['simple', /\bsimple\b/g],
    ] as const) {
      // These words are legitimate elsewhere ("no plain flat wall", "plain
      // yellow-on-black"), so only flag them in the same sentence as the worn item.
      // Split on line breaks as well as sentence ends: the design-tools block is
      // one long bullet, and without this the word "plain" in "plain
      // yellow-on-black" reads as sitting beside the word "product" ten lines away.
      const sentences = p.split(/\n|(?<=[.!?])\s+/)
      const bad = sentences.filter(s =>
        re.test(s.toLowerCase()) && /\b(wearing|worn|garment|product|item|shirt)\b/i.test(s)
        && !/NEVER a plain version|never simplified|those garments only/i.test(s))
      check(`[${name}] no sentence calls the worn product "${word}"`, bad.length === 0, bad[0])
    }
  }

  // ── 2. The palette may not own the product ────────────────────────────────
  if (input.wearLine && input.palette) {
    check(`[${name}] the palette is scoped away from the product`,
      /governs the BACKGROUND, type and graphics ONLY/.test(p),
      'a palette that governs everything restyles the garment to match the design')
  }

  // ── 3. Exactly ONE instruction about the face ─────────────────────────────
  // Three separate places used to name an expression. Whichever was later won,
  // and with a question headline that meant skeptical every time.
  if (input.expressionLine) {
    check(`[${name}] nothing asks for a "content-fitting" reaction`,
      !/content-fitting/i.test(p),
      'that phrase means "match the headline", and a question headline means skeptical')
    check(`[${name}] nothing tells it to fit the expression to the thumbnail`,
      !/expression to fit this thumbnail/i.test(p))
    check(`[${name}] the brief's own reaction is not also named`,
      !new RegExp(escapeRe(base().briefExpression as string), 'i').test(p),
      'the art director chose a mood too; both present averages to a blank face')
    check(`[${name}] the concept is told to keep out of it`,
      !input.concept || /IGNORE that part/.test(p))
    check(`[${name}] the chosen expression is the last word`,
      /FINAL CHECK — THE FACE/.test(p) && p.lastIndexOf('FINAL CHECK — THE FACE') > p.length - 900,
      'an instruction that must beat a design brief cannot only appear at the top')
  } else {
    check(`[${name}] auto leaves the old behaviour alone`,
      !/FINAL CHECK — THE FACE/.test(p))
  }

  // ── 3b. No other rule may claim the face ──────────────────────────────────
  // Found by reading a real assembled prompt, not by reading the template: the
  // "worn, not held" rule ended with "the same face, the same identity", written
  // months before expressions existed and colliding head-on with them. Any rule
  // that pins the face is a rule competing with the creator's pick.
  if (input.expressionLine) {
    const pins = p.split(/\n|(?<=[.!?])\s+/).filter(line =>
      /\bthe same face\b|\bkeep their expression\b|\bresting expression\b/i.test(line))
    check(`[${name}] nothing else pins the face`, pins.length === 0, pins[0])
  }

  // ── 4. The reference story is told one way, not both ──────────────────────
  // Telling the model to ignore an expression we deliberately put in the
  // reference is worse than saying nothing at all.
  if (input.expressionLine) {
    const copyIt = /already wears this exact expression/.test(p)
    const ignoreIt = /never of what their face is doing/.test(p)
    check(`[${name}] the reference is either the source of the expression or not, never both`,
      copyIt !== ignoreIt, `copy=${copyIt} ignore=${ignoreIt}`)
    check(`[${name}] and it matches how the reference was actually built`,
      copyIt === (input.expressionInReference === true))
  }

  // ── 5. A worn product appears in exactly one place ────────────────────────
  if (input.wearLine) {
    check(`[${name}] no hero shot is requested for a worn product`,
      !/accurately as the hero/.test(p),
      '"hero shot" plus "worn" is how a shirt lands on the person AND on a hanger')
    check(`[${name}] the garment gets the last word too`,
      /FINAL CHECK — THE GARMENT/.test(p))

    // ── 5b. The clothing story is told one way, not both ────────────────────
    // The root cause of the plain-polo regression was a photograph of the
    // creator in a plain polo sitting in the reference set. Which sentence is
    // correct depends entirely on whether that photograph is still there, and
    // saying both is how the model learns that neither is load-bearing.
    const onlyImage = /ONLY image here that shows clothing/.test(p)
    const differentDay = /a photo of a different day/.test(p)
    check(`[${name}] exactly one account of where clothing comes from`,
      onlyImage !== differentDay, `onlyImage=${onlyImage} differentDay=${differentDay}`)
    check(`[${name}] and it matches how the references were actually built`,
      onlyImage === (input.refsAreHeadOnly === true),
      'claiming the references carry no clothing while a full selfie is still in the set is the original bug, restated as a promise')
  }

  // ── 5c. Exactly ONE instruction about how much of them is in frame ────────
  // The sentence a full-body shot replaces is emphatic and absolute ("do NOT
  // invent or show their full body, legs, waist-down"). Leave it anywhere in the
  // prompt while asking for a full-body shot and the model splits the
  // difference, which is a cropped half-figure and a product you cannot see.
  {
    const forbids = /do NOT invent or show their full body/.test(p)
    const asks = /Show them FULL BODY/.test(p)
    check(`[${name}] exactly one framing instruction in the whole prompt`,
      forbids !== asks, `forbids=${forbids} asks=${asks}`)
    check(`[${name}] and it is the framing that was asked for`,
      asks === (input.framing === 'full'))
    check(`[${name}] a bust shot never describes a body it is not showing`,
      input.framing === 'full' || !/athletic, toned build/.test(p),
      'build and height are meaningless chest-up, and a stray one is a contradiction')
  }

  // ── 6. It is still a complete brief ───────────────────────────────────────
  check(`[${name}] the headline survives`, p.includes(input.line1) && p.includes(input.line2))
  check(`[${name}] the person is described`, /PERSON:/.test(p))
  check(`[${name}] the product is described`, /PRODUCT:/.test(p))
  check(`[${name}] nothing rendered as undefined`, !/undefined|\[object Object\]/.test(p), firstBad(p))
  check(`[${name}] no doubled blank lines from an empty section`, !/\n\n\n/.test(p))
  void lower
}

// ── the pieces, in isolation ────────────────────────────────────────────────
{
  // Not "contains no reaction word" — the correct line legitimately says "do not
  // substitute a reaction". What matters is that it never ASKS for one.
  const posed = personActionLine({ expressionLine: 'X', briefPose: 'pointing' })
  check('a chosen expression turns the action line into pose-only',
    !/^Give them |a natural, content-fitting/i.test(posed) && /specified separately/.test(posed), posed)
  check('and the pose still survives in it', /pointing/.test(posed), posed)
  check('and auto keeps the art director\'s reaction',
    /skeptical raised eyebrow/.test(personActionLine({ briefExpression: 'skeptical raised eyebrow' })))
  check('the wardrobe line never calls the product plain when worn',
    /NEVER to the product/.test(wardrobeLine({ wearLine: 'X' })))
  check('and falls back to the outfit line otherwise',
    wardrobeLine({ outfitDirective: 'WARDROBE: vary it.' }) === 'WARDROBE: vary it.')
  check('an empty palette produces no line at all',
    paletteLine(base({ palette: '' })) === '')
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function firstBad(p: string): string {
  const m = p.match(/.{0,60}(undefined|\[object Object\]).{0,60}/)
  return m ? m[0] : ''
}

console.log(failures.length ? `FAIL (${failures.length})` : `ALL PASS — ${all.length} scenarios`)
for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`)
if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`)
process.exit(failures.length ? 1 : 0)
