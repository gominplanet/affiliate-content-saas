// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every model we bill an image against has to be in PRICING.
//
// recordUsage takes a model name as a free string. If that name isn't in
// PRICING and the row carries images > 0, the cost falls through to
// IMAGE_COST_FALLBACK ($0.04). That fallback exists to stop a new image model
// being counted as free, which is the right instinct for an image model. It is
// exactly wrong for the things that produce an "image" and cost nothing:
//
//   simple-bake-resvg   a text bake on our own CPU, logged once per variant
//   pinterest-api       a Pinterest publish
//   youtube-data-api    a YouTube upload (quota units, not dollars)
//
// All three were charging $0.04 a call of money nobody spent, and the monthly
// AI spend ceiling is what cuts a creator off. A storefront creator publishing
// 100 videos and 100 pins lost $8 of their ceiling to free APIs before a single
// real render. This is the usual failure in this codebase wearing a new hat:
// the number on the dashboard described the plan (an image happened) instead of
// the result (nothing was paid for).
//
// The guard is the general one, not a list of the three: any model recorded
// with images and missing from PRICING fails here, so the next one is caught
// when it is added rather than when somebody reads a bill.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PRICING, IMAGE_COST_FALLBACK, costOf } from '../lib/ai-usage'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

// ── every billed image model is priced ──────────────────────────────────────
//
// Matches a recordUsage call that names a model AND passes images. Both orders
// occur in the codebase (model before images and after), so the scan accepts
// either rather than quietly missing half the call sites.
//
// It only sees LITERAL model names. Call sites that pass a variable (the env
// image model, a per-format override, the Nano Banana key) are invisible to it,
// so a clean run here means "no literal slipped through", not "every row is
// priced". Those variables all resolve to models that are in PRICING today; if
// one stops being, the cost-by-feature query is what shows it.
{
  const files = [...walk('app'), ...walk('lib'), ...walk('services')]
  const unpriced = new Map<string, string>() // model -> first file that bills it

  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/recordUsage\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
      const body = m[1]
      const model = body.match(/model:\s*'([^']+)'/)?.[1]
      const images = body.match(/images:\s*(\d+)/)?.[1]
      if (!model || !images || Number(images) === 0) continue
      if (model in PRICING) continue
      if (!unpriced.has(model)) unpriced.set(model, f)
    }
  }

  check('no model bills an image without a price',
    unpriced.size === 0,
    [...unpriced].map(([m, f]) => `${m} (${f})`).join(', ') +
    ` — each of these logs $${IMAGE_COST_FALLBACK} a call against the user's monthly ceiling. ` +
    'If it really costs that, add it to PRICING with the real number. If it costs nothing, add it at 0.')
}

// ── an unpriced TEXT model is worse than an unpriced image model ────────────
//
// costOf does `PRICING[r.model] ?? { in: 0, out: 0 }`. For an image row the
// IMAGE_COST_FALLBACK still catches it at $0.04. For a TEXT row there is no
// fallback at all, so a model nobody priced records as free — and a writer that
// costs nothing is a writer no spend ceiling can ever stop. Opus 5 was missing
// from PRICING for exactly this reason, found while checking the API contract
// rather than by anything going wrong, which is the point of this check.
{
  const files = [...walk('app'), ...walk('lib'), ...walk('services')]
  const unpriced = new Map<string, string>()

  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    // recordUsage / recordAnthropicUsage with a literal model and no images.
    for (const m of src.matchAll(/record(?:Anthropic)?Usage\(\s*(?:[^,]+,\s*)?\{([\s\S]{0,400}?)\}\s*\)/g)) {
      const body = m[1]
      const model = body.match(/model:\s*'([^']+)'/)?.[1]
      if (!model) continue
      const images = Number(body.match(/images:\s*(\d+)/)?.[1] ?? 0)
      if (images > 0) continue                 // covered by the image check above
      if (model in PRICING) continue
      if (/^(diagnostic|reserved|unknown)$/.test(model)) continue // deliberately free markers
      if (!unpriced.has(model)) unpriced.set(model, f)
    }
  }

  check('no text model bills tokens without a price',
    unpriced.size === 0,
    [...unpriced].map(([m, f]) => `${m} (${f})`).join(', ') +
    ' — a text model missing from PRICING records as $0, with no fallback to catch it')
}

// ── the free ones are actually free, not merely present ─────────────────────
//
// Adding a key with the wrong number would pass the scan above and still charge
// the creator. These three are known to cost nothing, so assert the number.
{
  for (const model of ['simple-bake-resvg', 'pinterest-api', 'youtube-data-api']) {
    const cost = costOf({ model, images: 1, input_tokens: 0, output_tokens: 0, web_searches: 0 })
    check(`${model} costs nothing`, cost === 0,
      `logged $${cost} for something we are not billed for`)
  }
}

// ── and the fallback still bites for a genuinely unknown image model ────────
//
// The point of the fallback is that a NEW image model is never counted as free.
// Pricing the three above at zero must not weaken that.
{
  const cost = costOf({
    model: 'some-image-model-nobody-priced-yet', images: 1,
    input_tokens: 0, output_tokens: 0, web_searches: 0,
  })
  check('an unpriced image model still falls back', cost === IMAGE_COST_FALLBACK,
    `got $${cost}; a model nobody priced must not read as free`)
}

if (failures.length) {
  console.error(`\n❌ usage-pricing: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ usage-pricing: every billed image has a price, the free ones are priced at zero, and an unknown image model still costs $0.04')
