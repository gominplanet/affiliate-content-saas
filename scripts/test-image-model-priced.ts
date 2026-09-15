// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BILLED IMAGE ROW NAMES A MODEL THAT HAS A PRICE, AT THE QUALITY IT RAN.
//
// costOf() falls back to IMAGE_COST_FALLBACK ($0.04) for any row with
// images > 0 whose model is not in PRICING. That fallback is a safety net, not
// a price, and a model that lands on it is mis-billed silently and permanently:
// nothing errors, nothing logs, and the number simply comes out wrong in the
// books and in the creator's spend ceiling.
//
// THE THREE THAT PROVED IT, all in generate-thumbnail:
//
//   1 + 2. Two recordUsage calls read `model: gfxModelOverride ?? 'gpt-image'`.
//          'gpt-image' is not a model anybody prices. Over 30 days that booked
//          41 hero expression-portraits at $0.04 against a render that costs
//          about $0.19, while the other 14 went out as 'gpt-image-1' ($0.19)
//          for a picture rendered at MEDIUM quality (~$0.06). Wrong in both
//          directions at once.
//
//   3.     generateFaceCutout renders at a HARDCODED quality: 'medium' and
//          recorded opts.imageModel, so every cut-out booked at the high rate
//          for a picture that costs about a third of it.
//
// All three were found only because somebody grouped ai_usage by model and did
// not recognise a name. OpenAI prices gpt-image by QUALITY, and the model
// string alone does not carry the quality, so the recorded name has to come
// from something that knows which one ran: gfxRecordOverride inside the
// handler, or a *_COST_MODEL constant where the quality is fixed at the call.
// The plain model variable never knows.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PRICING, IMAGE_COST_FALLBACK, costOf, type UsageRow } from '../lib/ai-usage'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const priced = new Set(Object.keys(PRICING))
function row(model: string, images: number): UsageRow {
  return { model, images, input_tokens: 0, output_tokens: 0, web_searches: 0 }
}

// ── the fallback exists, applies to images, and is NOT a price ─────────────
{
  check('the fallback is still a real number', IMAGE_COST_FALLBACK > 0)
  const unknownImage = costOf(row('a-model-nobody-priced', 1))
  check('an unpriced IMAGE model lands on it', unknownImage === IMAGE_COST_FALLBACK,
    `got ${unknownImage}; if this changes, every claim in this file needs re-checking`)
  const unknownZero = costOf(row('diagnostic', 0))
  check('an images:0 marker row still costs nothing', unknownZero === 0,
    `got ${unknownZero}; the diagnostic/reserved rows exist to be countable, not billable`)
  check('gpt-image medium and high are priced differently',
    PRICING['gpt-image-1-medium']!.imageCost !== PRICING['gpt-image-1']!.imageCost,
    'if they ever match, the whole quality-aware recording below is pointless and should go')
}

// ── every LITERAL model string on a BILLED row is priced ───────────────────
//
// Only literals: a variable holding an env value cannot be resolved here, and
// the env default is covered separately below. Only images > 0: 'diagnostic'
// and 'reserved' are deliberate zero-cost marker rows, and costOf charges
// nothing for them.
{
  const roots = ['app/api', 'lib']
  const files: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) files.push(p)
    }
  }
  roots.forEach(walk)
  check('there are files to scan', files.length > 50, `${files.length}`)

  let literalsSeen = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/recordUsage\(\{[\s\S]{0,400}?\}\)/g)) {
      const call = m[0]
      const images = parseInt(call.match(/images:\s*(\d+)/)?.[1] ?? '0', 10)
      if (images < 1) continue
      const name = call.match(/model:\s*'([^']+)'\s*,/)?.[1]
      if (!name) continue
      literalsSeen++
      check(`${f} bills under a priced model`, priced.has(name),
        `"${name}" is not in PRICING, so every one of those rows books at the $${IMAGE_COST_FALLBACK} fallback instead of its real cost`)
    }
  }
  check('some billed literal model names were found', literalsSeen > 3, `${literalsSeen}`)
}

const ROUTE = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')

// ── the image env default is priced ────────────────────────────────────────
//
// Several sites read `process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'`. The
// literal default has to be priced or the whole hero path bills at the fallback
// on any deployment that does not set the env var.
{
  let defaultsSeen = 0
  for (const m of ROUTE.matchAll(/process\.env\.OPENAI_IMAGE_MODEL \|\| '([^']+)'/g)) {
    defaultsSeen++
    check(`the image env default "${m[1]}" is priced`, priced.has(m[1]),
      'an unset OPENAI_IMAGE_MODEL would put every hero render on the fallback rate')
  }
  check('the env default is actually written somewhere', defaultsSeen > 0, `${defaultsSeen}`)
}

// ── a gpt-image row records the QUALITY it rendered at ─────────────────────
//
// The rule is about ONE family. fal-rembg, fal-flux, simple-bake and ideogram
// name a specific service at a single rate and have no quality dimension, so
// they are out of scope by construction rather than by exception list: the
// check only fires on a call whose recorded model comes from a gpt-image
// variable. Such a call must ALSO consult something that knows the quality,
// which is gfxRecordOverride in the handler or a *_COST_MODEL constant where
// the call site fixes the quality itself.
{
  const QUALITY_BLIND = /\b(opts\.imageModel|gfxModelP?|gfxModelOverride|OPENAI_IMAGE_MODEL)\b/
  const QUALITY_AWARE = /\b(gfxRecordOverride|[A-Z_]+_COST_MODEL)\b/

  const imageRecords = [...ROUTE.matchAll(/recordUsage\(\{[^}]*images:\s*1[^}]*\}\)/g)].map(m => m[0])
  check('the route records image usage at all', imageRecords.length >= 12, `${imageRecords.length}`)

  let guarded = 0
  for (const call of imageRecords) {
    const model = call.match(/model:\s*([^,]+(?:,[^,]*\))?)\s*,\s*images/)?.[1] ?? call
    if (!QUALITY_BLIND.test(model)) continue
    guarded++
    const feature = call.match(/feature:\s*'?([A-Za-z_]+)'?/)?.[1] ?? '(unknown)'
    check(`${feature} records the quality it rendered`, QUALITY_AWARE.test(model),
      `records \`${model.trim()}\`, which names the model but not the quality, so a medium render bills at the high rate`)
  }
  check('the gpt-image rows were actually examined', guarded >= 3, `${guarded}`)

  check("the bare 'gpt-image' literal is gone", !/\?\?\s*'gpt-image'/.test(ROUTE),
    "it is not a model anybody prices; it booked 41 renders at the fallback rate")
}

// ── the cut-out records medium because it RENDERS medium ───────────────────
//
// generateFaceCutout sits outside the handler, so gfxRecordOverride is out of
// scope and the check above passes on the constant alone. What makes the
// constant the RIGHT one is the hardcoded quality two lines above it, so both
// halves are pinned here: if somebody later lets the quality vary, this fails
// and the row has to start following it.
{
  const start = ROUTE.indexOf('async function generateFaceCutout')
  check('generateFaceCutout is still there', start > 0)
  const body = ROUTE.slice(start, ROUTE.indexOf('yt_thumb_cutout_rembg', start))
  const quality = body.match(/quality:\s*'(\w+)'/)?.[1]
  check('the cut-out render still fixes its quality', quality === 'medium',
    `renders at "${quality}"; if this is no longer fixed, the recorded model cannot be a constant`)
  const recorded = body.match(/feature: 'yt_thumb_face_cutout', model: ([^,]+),/)?.[1]?.trim()
  check('and the row names a medium-priced model',
    recorded === 'GPT_IMAGE_COMPOSE_COST_MODEL',
    `records \`${recorded}\`; the render is medium (~$${PRICING['gpt-image-1-medium']!.imageCost}) and anything else books it at the high rate`)
  check('and that constant is in fact the medium price',
    /GPT_IMAGE_COMPOSE_COST_MODEL = 'gpt-image-1-medium'/.test(readFileSync('lib/thumbnail-generators.ts', 'utf8')),
    'the constant is what makes the line above true')
}

if (failures.length) {
  console.error(`\n❌ image-model-priced: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ image-model-priced: every billed image row names a priced model, at the quality it actually rendered')
