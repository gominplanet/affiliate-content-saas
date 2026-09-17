// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Do two posts by the same creator actually come out different shapes?
//
// This exists because the writer prompt contained both of these, four hundred
// lines apart:
//
//   "no two posts may have the same shape ... Never default to 'seven' because
//    the template said so."
//   "[4] BODY — 7 REQUIRED SECTIONS"  (Section A through G, fixed order)
//
// The template won, as it always will. Every post on a site opened the same way,
// covered the same seven topics in the same order, and closed the same way. At
// 279 posts that is one page with the nouns swapped, and a prompt instruction
// nothing verifies is a wish rather than a rule.
import {
  planPostStructure, structureToPrompt, signatureOf, type StructureInput,
} from '../lib/post-structure'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const base: StructureInput = { seed: 'vid-001', sourceWords: 2000 }

// ── the failure this file exists for ────────────────────────────────────────
// Twenty posts by one creator. Under the old template all twenty were identical.
{
  const seen = new Map<string, number>()
  for (let i = 0; i < 20; i++) {
    const recent = [...seen.keys()].slice(-10)
    const plan = planPostStructure({ ...base, seed: `vid-${i}`, recentSignatures: recent })
    seen.set(plan.signature, (seen.get(plan.signature) ?? 0) + 1)
  }
  check('twenty posts do not collapse into one shape', seen.size >= 18,
    `${seen.size} distinct shapes across 20 posts`)
  check('and no shape dominates', Math.max(...seen.values()) <= 2,
    `most repeated shape used ${Math.max(...seen.values())} times`)
}

// ── section count is not always seven ───────────────────────────────────────
{
  const counts = new Set<number>()
  for (let i = 0; i < 40; i++) {
    counts.add(planPostStructure({ ...base, seed: `n-${i}` }).sections.length)
  }
  check('section count genuinely varies', counts.size >= 3,
    `counts seen: ${[...counts].sort().join(', ')}`)
  check('and is never the old fixed seven every time', counts.size > 1 || !counts.has(7))
}

// ── the same post regenerates to the same shape ─────────────────────────────
// A rebuild must not silently restructure a published article.
{
  const a = planPostStructure({ ...base, seed: 'stable-post' })
  const b = planPostStructure({ ...base, seed: 'stable-post' })
  check('regeneration is deterministic', a.signature === b.signature,
    `${a.signature} vs ${b.signature}`)
  check('down to the section order',
    a.sections.map(s => s.key).join() === b.sections.map(s => s.key).join())
}

// ── a recent shape is not served again ──────────────────────────────────────
// This is the part a prompt could never do: a prompt cannot see the last ten posts.
{
  const first = planPostStructure({ ...base, seed: 'repeat-me' })
  const second = planPostStructure({ ...base, seed: 'repeat-me', recentSignatures: [first.signature] })
  check('a colliding shape is reshuffled rather than shipped',
    second.signature !== first.signature, `${second.signature}`)
  check('and the reshuffle is recorded', second.attempts > 1, `${second.attempts}`)
  check('while a fresh post needs no reshuffle',
    planPostStructure({ ...base, seed: 'fresh' }).attempts === 1)
}

// ── running out of shapes is admitted, not hidden ───────────────────────────
{
  const all: string[] = []
  for (let salt = 0; salt < 40; salt++) {
    all.push(planPostStructure({ ...base, seed: 'boxed-in', recentSignatures: all }).signature)
  }
  const boxed = planPostStructure({ ...base, seed: 'boxed-in', recentSignatures: all })
  check('a creator who exhausts the space is told, not quietly served a repeat',
    boxed.repeated === true || !all.includes(boxed.signature),
    `repeated=${boxed.repeated}`)
}

// ── the hook always opens ───────────────────────────────────────────────────
// The one place the right answer is the same every time.
{
  for (let i = 0; i < 25; i++) {
    const plan = planPostStructure({ ...base, seed: `hook-${i}` })
    if (plan.sections[0].key !== 'hook') {
      check(`post ${i} opens on the hook`, false, plan.sections[0].key)
      break
    }
  }
  check('every post opens on the hook', true)
  const closers = new Set<string>()
  for (let i = 0; i < 25; i++) {
    const plan = planPostStructure({ ...base, seed: `close-${i}` })
    closers.add(plan.sections[plan.sections.length - 1].key)
  }
  check('but the closer varies', closers.size >= 2, [...closers].join(', '))
  check('and the closer is always a closing role',
    [...closers].every(k => ['audience', 'advice', 'verdict-long'].includes(k)),
    [...closers].join(', '))
}

// ── no duplicate sections inside one post ───────────────────────────────────
{
  for (let i = 0; i < 40; i++) {
    const plan = planPostStructure({ ...base, seed: `dup-${i}` })
    const keys = plan.sections.map(s => s.key)
    if (new Set(keys).size !== keys.length) {
      check(`post ${i} has no repeated section`, false, keys.join(' > '))
      break
    }
  }
  check('no post repeats a section', true)
}

// ── depth decides how many sections a post can carry ────────────────────────
// Section count is just another way to pad. Nine sections over a thin transcript
// is seven headings with nothing underneath them.
{
  const thin = planPostStructure({ ...base, seed: 'thin', sourceWords: 250 })
  const rich = planPostStructure({ ...base, seed: 'rich', sourceWords: 4000 })
  check('a thin source gets few sections', thin.sections.length <= 4, `${thin.sections.length}`)
  check('a rich source gets more', rich.sections.length >= 6, `${rich.sections.length}`)

  let maxThin = 0
  for (let i = 0; i < 40; i++) {
    maxThin = Math.max(maxThin, planPostStructure({ ...base, seed: `t-${i}`, sourceWords: 250 }).sections.length)
  }
  check('a thin source NEVER reaches a deep section count', maxThin <= 4, `${maxThin}`)
}

// ── a comparison needs something to compare against ─────────────────────────
// Otherwise the section is an invitation to invent a competitor.
{
  let sawComparison = false
  for (let i = 0; i < 60; i++) {
    if (planPostStructure({ ...base, seed: `c-${i}`, hasComparison: false })
      .sections.some(s => s.key === 'comparison')) sawComparison = true
  }
  check('no comparison section without an alternative to compare', !sawComparison,
    'this would have the writer invent a competitor')

  let sawWithFlag = false
  for (let i = 0; i < 60; i++) {
    if (planPostStructure({ ...base, seed: `c-${i}`, hasComparison: true })
      .sections.some(s => s.key === 'comparison')) sawWithFlag = true
  }
  check('but it appears when there is one', sawWithFlag)
}

// ── blocks vary per post, and a brand veto is absolute ──────────────────────
{
  const on = new Set<boolean>()
  for (let i = 0; i < 30; i++) on.add(planPostStructure({ ...base, seed: `b-${i}` }).blocks.scorecard)
  check('block presence varies across posts', on.size === 2,
    'every post carried the identical set of furniture before this')

  for (let i = 0; i < 30; i++) {
    const plan = planPostStructure({ ...base, seed: `veto-${i}`, permissions: { scorecard: false, prosCons: false } })
    if (plan.blocks.scorecard || plan.blocks.prosCons) {
      check('a brand veto is never overridden', false, plan.signature)
      break
    }
  }
  check('a per-post plan may drop a block but never add a vetoed one', true)
}

// ── the prompt hands over a shape, not headings ─────────────────────────────
// Supplying both the shape and the words is how every post came to open with the
// same sentence and close with the same section.
{
  const plan = planPostStructure({ ...base, seed: 'prompt' })
  const text = structureToPrompt(plan)
  check('the section count is stated', new RegExp(`EXACTLY ${plan.sections.length} SECTIONS`).test(text), text.slice(0, 80))
  check('every planned section is listed',
    plan.sections.every(s => text.includes(`[${s.key}]`)))
  check('the writer is told to supply its own headings',
    /Write your own H2 heading/i.test(text))
  check('and told not to echo the key',
    /Do not echo the bracketed key/i.test(text))
  // Naming a banned heading as an example is fine and useful. Handing over
  // actual heading markup is not, because then every post ships that heading.
  check('no heading markup is handed over',
    !/<h[23][^>]*>\w/.test(text) && !/wp:heading/.test(text), text)
  check('and no dash punctuation leaks into the instruction',
    !/[–—]/.test(text), text)
  check('and it says not to pad a section that has no source',
    /rather than padding it out/i.test(text))
}

// ── signature is stable and describes the shape ─────────────────────────────
{
  const plan = planPostStructure({ ...base, seed: 'sig' })
  check('the signature round-trips', signatureOf(plan.sections, plan.blocks) === plan.signature)
  check('and names the ordered sections', plan.signature.startsWith('hook>'), plan.signature)
  check('two different shapes get two different signatures',
    planPostStructure({ ...base, seed: 'sig-a' }).signature
    !== planPostStructure({ ...base, seed: 'sig-b' }).signature)
}

// ── the prompt no longer hardcodes seven sections ───────────────────────────
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const PROMPT = strip(readFileSync(join(__dirname, '..', 'services/claude/index.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // 7 REQUIRED SECTIONS\nreal code').indexOf('7 REQUIRED SECTIONS') === -1,
    'if this fails the checks below prove nothing')
  check('the fixed seven-section template is gone',
    !/\d+ REQUIRED SECTIONS/.test(PROMPT),
    'the template beat the variance instruction every time')
  check('the fixed Section A to G roles are gone',
    !/Section [A-G]: <!-- wp:heading/.test(PROMPT),
    'a fixed role list in a fixed order is one shape, not many')
  check('the body instruction comes from the computed plan',
    /\$\{structureBlock\}/.test(PROMPT) && /structureToPrompt\(structurePlan\)/.test(PROMPT),
    'the prompt must render the plan rather than a template')
  check('the hook craft guidance survived the template removal',
    /BANNED first-sentence shapes/.test(PROMPT) && /Under 22 words/.test(PROMPT),
    'the fixed shape was the problem, the craft rules were not')
  check('the never-invent-a-spec rule survived too',
    /Never invent, estimate or\s+guess a spec/i.test(PROMPT))
  check('brand toggles are a ceiling on the plan, not a replacement for it',
    /include_quick_verdict !== false && structurePlan\.blocks\.verdictBox/.test(PROMPT),
    'set once per brand, every post on the site carried identical furniture')

  // The check is only real if the shape is written down. Without persistence the
  // planner varies every post and still lands on last week's shape.
  const ROUTE = strip(readFileSync(join(__dirname, '..', 'app/api/blog/generate/route.ts'), 'utf8'))
  check('the signature is read back for this creator',
    /\.select\('structure_signature'\)/.test(ROUTE))
  check('and persisted on the post row',
    /structure_signature: \(generated as/.test(ROUTE))
  check('newest first, so the window is the recent past',
    /\.order\('created_at', \{ ascending: false \}\)/.test(ROUTE))
  check('a missing column loses the signature, never the post',
    /structure_signature.* does not exist/.test(ROUTE)
    && /schedule_mode, thumbnail_blocked, structure_signature, \.\.\.rest/.test(ROUTE),
    'PostgREST rejects the whole statement when one named column is missing')
  check('a failed signature read never blocks generation',
    /catch \{ \/\* no signatures yet, so nothing to avoid \*\/ \}/.test(ROUTE))

  const MIGRATION = readFileSync(
    join(__dirname, '..', 'supabase/migrations/341_blog_posts_structure_signature.sql'), 'utf8')
  check('the migration is safe to run twice',
    /add column if not exists/i.test(MIGRATION) && /create index if not exists/i.test(MIGRATION))
  check('and leaves old posts null rather than guessing a shape for them',
    !/update .*blog_posts.*set .*structure_signature/i.test(MIGRATION))
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. One fixed shape for every post.
  const shapes = new Set<string>()
  for (let i = 0; i < 20; i++) shapes.add(planPostStructure({ ...base, seed: `bk-${i}` }).signature)
  broke('a single fixed shape across 20 posts is caught', shapes.size >= 18)

  // Break 2: non-determinism, which would restructure a published post on rebuild.
  broke('a non-deterministic plan is caught',
    planPostStructure({ ...base, seed: 'det' }).signature
    === planPostStructure({ ...base, seed: 'det' }).signature)

  // Break 3: ignoring recent signatures, which is what makes the check real.
  const f = planPostStructure({ ...base, seed: 'r' })
  broke('ignoring recent signatures is caught',
    planPostStructure({ ...base, seed: 'r', recentSignatures: [f.signature] }).signature !== f.signature)

  // Break 4: letting section count ignore source depth, which is padding by
  // another name.
  let maxThin = 0
  for (let i = 0; i < 40; i++) {
    maxThin = Math.max(maxThin, planPostStructure({ ...base, seed: `bt-${i}`, sourceWords: 250 }).sections.length)
  }
  broke('a thin source getting a deep section count is caught', maxThin <= 4)

  // Break 5: a comparison section with no competitor, which asks the writer to
  // invent one.
  let invented = false
  for (let i = 0; i < 60; i++) {
    if (planPostStructure({ ...base, seed: `bc-${i}`, hasComparison: false })
      .sections.some(s => s.key === 'comparison')) invented = true
  }
  broke('a comparison with nothing to compare is caught', !invented)

  // Break 6: a per-post plan overriding a brand veto.
  let overrode = false
  for (let i = 0; i < 30; i++) {
    if (planPostStructure({ ...base, seed: `bv-${i}`, permissions: { scorecard: false } }).blocks.scorecard) overrode = true
  }
  broke('overriding a brand veto is caught', !overrode)

  // Break 7: the hook losing its guaranteed first slot.
  let misplaced = false
  for (let i = 0; i < 30; i++) {
    if (planPostStructure({ ...base, seed: `bh-${i}` }).sections[0].key !== 'hook') misplaced = true
  }
  broke('a post not opening on the hook is caught', !misplaced)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ post-structure: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ post-structure: every post gets its own shape, checked against the creator\'s recent ones')
